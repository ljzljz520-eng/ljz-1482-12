/**
 * 待修复冲突的显式解决。
 * 解决动作本身也走引擎提交、产生修订与证据；任何选项都不允许无声丢内容。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { newId } from "../lib/ids.js";
import { EngineError } from "../domain/engine.js";
import type { Operation, OpBody } from "../domain/types.js";
import { commitOperation } from "./commits.js";
import { loadSnapshot } from "./snapshot.js";

export type ResolutionChoice =
  | { action: "use_incoming" } // 采用我的（字段：新值；split_vs_delete：恢复原场后再拆）
  | { action: "keep_existing" } // 保留现状（放弃此次意图，但留痕）
  | { action: "adopt_orphans" } // 原场已删：把我要拆出的元素恢复为待归场孤儿，等待重新归场
  | { action: "custom"; value?: string }; // 字段：手动给值

export async function listConflicts(scriptId: string) {
  const rows = await prisma.mergeConflict.findMany({
    where: { scriptId, status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    opId: r.opId,
    kind: r.kind,
    status: r.status,
    author: { id: r.authorId, name: r.authorName },
    baseSeq: r.baseSeq,
    op: r.op,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function markResolved(
  id: string,
  resolution: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  await client.mergeConflict.update({
    where: { id },
    data: { status: "resolved", resolution, resolvedAt: new Date() },
  });
}

export async function resolveConflict(
  scriptId: string,
  conflictId: string,
  choice: ResolutionChoice,
  actor: { id: string; name: string },
): Promise<{ seq: number; note: string }> {
  const row = await prisma.mergeConflict.findFirst({ where: { id: conflictId, scriptId } });
  if (!row) throw new EngineError("冲突不存在", "not_found");
  if (row.status !== "pending") throw new EngineError("冲突已处理", "bad_request");

  const storedOp = row.op as unknown as Operation;
  const snap = await loadSnapshot(scriptId);
  if (!snap) throw new EngineError("脚本不存在", "not_found");
  const headSeq = snap.seq;

  // 通用：以当前 head 为基，构造解决操作
  const rebaseOp = (body: OpBody): Operation => ({
    opId: newId("resolve"),
    baseSeq: headSeq,
    author: actor,
    body,
  });

  let seq = 0;
  let note = "";

  if (row.kind === "field") {
    const detail = row.detail as {
      field: string;
      incoming: unknown;
      existing: unknown;
      elementId?: string;
      sceneId?: string;
    };
    if (choice.action === "keep_existing") {
      note = `保留当前值，放弃来自 ${row.authorName} 的修改（已留痕）`;
    } else {
      const value =
        choice.action === "custom"
          ? (choice as { value?: string }).value
          : detail.incoming;
      const body: OpBody = detail.elementId
        ? {
            type: "editElement",
            elementId: detail.elementId,
            fields: { [detail.field]: coerce(detail.field, value) } as Record<string, never>,
          }
        : {
            type: "renameScene",
            sceneId: detail.sceneId as string,
            title: String(value ?? ""),
          };
      const r = await commitOperation(scriptId, rebaseOp(body));
      if (r.status !== "applied") throw new EngineError("解决时再次冲突，请重试", "conflict");
      seq = r.seq;
      note = `采用新值解决字段冲突（${detail.field}）`;
    }
  } else if (row.kind === "split_vs_delete") {
    const op = storedOp.body as Extract<OpBody, { type: "splitScene" }>;
    const deletedScene = snap.scenes.find((x) => x.id === op.sceneId);

    if (choice.action === "keep_existing") {
      note = "保留乙的删除结果；甲的拆场意图不执行（操作已存档，不丢内容）";
    } else if (choice.action === "adopt_orphans") {
      // 原场保持删除，但把甲选中的元素恢复成"待归场"，用户可在待修复面板重新归场
      const r = await commitOperation(
        scriptId,
        rebaseOp({
          type: "restoreState",
          reason: `resolve conflict ${row.opId}: 元素从已删场次抢救为待归场`,
          elements: op.afterElementIds.map((id, i) => {
            const original = snap.elements.find((e) => e.id === id);
            return {
              id,
              sceneId: null,
              originSceneId: original?.originSceneId ?? op.sceneId,
              kind: original?.kind ?? "shot",
              roleId: original?.roleId ?? null,
              content: original?.content ?? "",
              durationSec: original?.durationSec ?? 0,
              orderIdx: 9000 + i,
              needsReview: true,
              reviewReason: "甲拆场、乙删原场：元素被抢救出场，等待人工重新归场",
              deletedAt: null,
            };
          }),
          touched: op.afterElementIds.map((id) => ({ kind: "element" as const, id })),
        }),
      );
      if (r.status !== "applied") throw new EngineError("解决时再次冲突，请重试", "conflict");
      seq = r.seq;
      note = "原场维持删除；甲拆出的元素已抢救为待归场，内容未丢失";
    } else {
      // use_incoming：先恢复乙删掉的原场（含原元素归位），再执行甲的拆分
      const payload = storedOp as Operation;
      const r1 = await commitOperation(
        scriptId,
        rebaseOp({
          type: "restoreState",
          reason: `resolve conflict ${row.opId}: 先恢复被乙删除的原场`,
          scenes: deletedScene ? [{ ...deletedScene, deletedAt: null, deleteReason: null }] : undefined,
          elements: snap.elements
            // 只恢复仍处于"待归场"且原本来自该场的元素；已手动归场/删除的不抢回
            .filter(
              (e) =>
                e.sceneId === null &&
                !e.deletedAt &&
                (e.originSceneId === op.sceneId ||
                  op.afterElementIds.includes(e.id)),
            )
            .map((e) => ({ ...e, sceneId: op.sceneId, needsReview: false, reviewReason: null, deletedAt: null })),
        }),
      );
      if (r1.status !== "applied") throw new EngineError("恢复原场时再次冲突，请重试", "conflict");
      const r2 = await commitOperation(scriptId, {
        ...payload,
        opId: newId("op"),
        baseSeq: r1.seq,
        author: actor,
      });
      if (r2.status !== "applied") throw new EngineError("重新拆分时再次冲突", "conflict");
      seq = r2.seq;
      note = "已恢复乙删除的原场，并完成甲的拆场（两者意图均保留）";
    }
  } else {
    // merge_vs_delete / delete_vs_edit / missing_identity
    if (choice.action === "keep_existing") {
      note = `保留当前结构，放弃 ${row.authorName} 的结构操作（已存档）`;
    } else if (choice.action === "use_incoming") {
      const payload = storedOp as Operation;
      const r = await commitOperation(scriptId, {
        ...payload,
        opId: newId("op"),
        baseSeq: headSeq,
        author: actor,
      });
      if (r.status !== "applied") throw new EngineError("再次应用时冲突，请改用其他选项", "conflict");
      seq = r.seq;
      note = "在当前修订上重新应用了原结构操作";
    } else if (choice.action === "adopt_orphans") {
      const detail = row.detail as { elementIds?: string[] };
      const r = await commitOperation(
        scriptId,
        rebaseOp({
          type: "restoreState",
          reason: `resolve conflict ${row.opId}: 抢救元素为待归场`,
          elements: (detail.elementIds ?? []).map((id, i) => {
            const original = snap.elements.find((e) => e.id === id);
            return {
              id,
              sceneId: null,
              originSceneId: original?.originSceneId ?? null,
              kind: original?.kind ?? "shot",
              roleId: original?.roleId ?? null,
              content: original?.content ?? "",
              durationSec: original?.durationSec ?? 0,
              orderIdx: 9000 + i,
              needsReview: true,
              reviewReason: "结构冲突后抢救出场，等待人工重新归场",
              deletedAt: null,
            };
          }),
          touched: (detail.elementIds ?? []).map((id) => ({ kind: "element" as const, id })),
        }),
      );
      if (r.status !== "applied") throw new EngineError("解决时再次冲突", "conflict");
      seq = r.seq;
      note = "涉及元素已抢救为待归场，内容未丢失";
    } else {
      throw new EngineError("不支持的解决方式", "bad_request");
    }
  }

  await prisma.$transaction(async (tx) => {
    await markResolved(row.id, `${choice.action}: ${note}`, tx);
  });
  return { seq, note };
}

function coerce(field: string, value: unknown): string | number | null {
  if (field === "durationSec") {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(n) || n < 0) throw new EngineError("时长必须是非负数字", "bad_request");
    return n;
  }
  if (field === "roleId") return value == null ? null : String(value);
  return value == null ? "" : String(value);
}
