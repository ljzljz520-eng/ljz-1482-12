/**
 * 提交流程：事务内装载快照 → 引擎三路提交 → 差异持久化 → 追加修订（变更证据）。
 * 同一 opId 幂等（断线重复提交安全）。结构/字段冲突落 MergeConflict，绝不丢弃原操作。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import {
  type CommitResult,
  type Conflict,
  type Operation,
  type Snapshot,
} from "../domain/types.js";
import {
  cloneSnapshot,
  commit,
  EngineError,
  fingerprints,
  touchedBy,
} from "../domain/engine.js";
import { loadSnapshot, persistSnapshot } from "./snapshot.js";
import { loadHistory, summarize } from "./history.js";

export interface CommitResponse {
  status: "applied";
  seq: number;
  headSeq: number;
  rebased: boolean;
  rebasedOnto: number[];
  duplicate?: boolean;
}

/** 提取撤销所需的"操作前"实体状态（inverse） */
function extractInverse(before: Snapshot, op: Operation) {
  const b = op.body;
  const inv: Record<string, unknown> = {};
  const sceneIds = new Set<string>();
  const elemIds = new Set<string>();

  switch (b.type) {
    case "splitScene":
      sceneIds.add(b.sceneId);
      b.afterElementIds.forEach((id) => elemIds.add(id));
      inv.scenes = before.scenes.filter((x) => sceneIds.has(x.id));
      inv.elements = before.elements.filter((x) => elemIds.has(x.id));
      break;
    case "mergeScenes":
      sceneIds.add(b.sceneIdA);
      sceneIds.add(b.sceneIdB);
      before.elements.filter((e) => e.sceneId === b.sceneIdB).forEach((e) => elemIds.add(e.id));
      inv.scenes = before.scenes.filter((x) => sceneIds.has(x.id));
      inv.elements = before.elements.filter((x) => elemIds.has(x.id));
      break;
    case "deleteScene":
      sceneIds.add(b.sceneId);
      inv.scenes = before.scenes.filter((x) => sceneIds.has(x.id));
      inv.elements = before.elements.filter((e) => e.sceneId === b.sceneId);
      break;
    case "deleteElement":
      elemIds.add(b.elementId);
      inv.elements = before.elements.filter((x) => elemIds.has(x.id));
      inv.anchors = before.anchors.filter(
        (a) => a.elementId === b.elementId || a.targetElementId === b.elementId,
      );
      inv.ranges = before.ranges.filter((r) => r.elementId === b.elementId);
      break;
    case "addElement":
      elemIds.add(b.element.id);
      inv.elements = before.elements.filter((x) => elemIds.has(x.id));
      break;
    case "renameScene":
      sceneIds.add(b.sceneId);
      inv.scenes = before.scenes.filter((x) => sceneIds.has(x.id));
      break;
    case "reattachElement":
      elemIds.add(b.elementId);
      inv.elements = before.elements.filter((x) => elemIds.has(x.id));
      break;
    default:
      if (b.type === "editElement" || b.type === "setDuration") {
        elemIds.add(b.elementId);
        inv.elements = before.elements.filter((x) => elemIds.has(x.id));
      }
      if (b.type === "restoreState") {
        inv.scenes = before.scenes.filter((x) => (b.scenes ?? []).some((q) => q.id === x.id));
        inv.elements = before.elements.filter((x) => (b.elements ?? []).some((q) => q.id === x.id));
        inv.anchors = before.anchors.filter((x) => (b.anchors ?? []).some((q) => q.id === x.id));
        inv.ranges = before.ranges.filter((x) => (b.ranges ?? []).some((q) => q.id === x.id));
      }
  }
  return inv;
}

async function saveConflict(scriptId: string, conflict: Conflict, baseSeq: number): Promise<void> {
  await prisma.mergeConflict.upsert({
    where: { opId: conflict.opId },
    update: {},
    create: {
      scriptId,
      opId: conflict.opId,
      status: "pending",
      kind: conflict.kind === "field" ? "field" : conflict.type,
      op: conflict.op as unknown as Prisma.InputJsonValue,
      authorId: conflict.op.author.id,
      authorName: conflict.op.author.name,
      baseSeq,
      detail: (conflict.kind === "field"
        ? {
            field: conflict.field,
            incoming: conflict.incoming,
            existing: conflict.existing,
            base: conflict.base,
            elementId: conflict.elementId,
            sceneId: conflict.sceneId,
          }
        : { message: conflict.message, sceneIds: conflict.sceneIds, elementIds: conflict.elementIds }) as Prisma.InputJsonValue,
    },
  });
}

export async function commitOperation(
  scriptId: string,
  op: Operation,
): Promise<CommitResponse | { status: "conflict"; conflict: Conflict }> {
  // 幂等：断线重发同一 opId 直接回放首次结果
  const existing = await prisma.revision.findUnique({ where: { opId: op.opId } });
  if (existing) {
    logger.info({ opId: op.opId, seq: existing.seq }, "duplicate op ignored (idempotent replay)");
    const script = await prisma.script.findUniqueOrThrow({ where: { id: scriptId } });
    return {
      status: "applied",
      seq: existing.seq,
      headSeq: script.headSeq,
      rebased: existing.rebasedFrom != null,
      rebasedOnto: existing.rebasedOnto,
      duplicate: true,
    };
  }

  const txResult = await prisma.$transaction(async (tx) => {
    const script = await tx.script.findUnique({ where: { id: scriptId } });
    if (!script) throw new EngineError("脚本不存在", "not_found");

    const before = await loadSnapshot(scriptId);
    if (!before) throw new EngineError("脚本快照不存在", "not_found");
    const head = cloneSnapshot(before);
    const history = await loadHistory(scriptId);

    let result: CommitResult;
    try {
      result = commit(head, history, op);
    } catch (e) {
      if (e instanceof EngineError) throw e;
      throw e;
    }

    if (result.status === "conflict") {
      // 冲突不改变任何状态：事务正常提交（空写），冲突记录在事务外持久化
      return { status: "conflict", conflict: result.conflict } as const;
    }

    await persistSnapshot(tx, before, head);

    const touches = touchedBy(op.body, before);
    const inverse = extractInverse(before, op);
    const newSeq = result.seq;

    await tx.revision.create({
      data: {
        scriptId,
        seq: newSeq,
        opId: op.opId,
        kind: op.body.type,
        authorId: op.author.id,
        authorName: op.author.name,
        summary: summarize(op.body),
        baseSeq: op.baseSeq,
        payload: { op, inverse } as unknown as Prisma.InputJsonValue,
        touched: touches as Prisma.InputJsonValue,
        fingerprints: fingerprints(before, touches) as Prisma.InputJsonValue,
        rebasedFrom: result.rebased ? op.baseSeq : null,
        rebasedOnto: result.rebasedOnto,
        undoable: op.body.type !== "restoreState",
      },
    });

    await tx.script.update({ where: { id: scriptId }, data: { headSeq: newSeq } });
    logger.info(
      { opId: op.opId, seq: newSeq, kind: op.body.type, author: op.author.name, rebased: result.rebased },
      "revision committed",
    );

    return {
      status: "applied" as const,
      seq: newSeq,
      headSeq: newSeq,
      rebased: result.rebased,
      rebasedOnto: result.rebasedOnto,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 10_000,
  });

  if (txResult.status === "conflict") {
    await saveConflict(scriptId, txResult.conflict, op.baseSeq);
    logger.warn(
      { opId: op.opId, type: txResult.conflict.type, author: op.author.name },
      "commit produced explicit conflict",
    );
    return { status: "conflict", conflict: txResult.conflict };
  }
  return txResult;
}
