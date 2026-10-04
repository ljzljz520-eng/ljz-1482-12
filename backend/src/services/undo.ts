/**
 * 撤销服务：
 * - 只能撤销本人创建的修订；
 * - 指纹/触碰校验：他人在该修订之后改过同一身份 -> 硬拒绝（不抹掉他人内容）；
 * - 反转以 restoreState 表达，恢复数据取自提交时保存的 inverse（操作前证据）。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { newId } from "../lib/ids.js";
import { logger } from "../lib/logger.js";
import type {
  MediaRange,
  Operation,
  RevisionRecord,
  SceneNode,
  Snapshot,
  SubtitleAnchor,
  Element,
} from "../domain/types.js";
import { apply, canUndo, cloneSnapshot, EngineError, fingerprints, touchedBy } from "../domain/engine.js";
import { loadSnapshot, persistSnapshot } from "./snapshot.js";
import { loadHistory } from "./history.js";

interface InversePayload {
  scenes?: SceneNode[];
  elements?: Element[];
  anchors?: SubtitleAnchor[];
  ranges?: MediaRange[];
}

export async function undoRevision(
  scriptId: string,
  seq: number,
  actor: { id: string; name: string },
): Promise<{ seq: number; warnings: string[] }> {
  return prisma.$transaction(async (tx) => {
    const targetRow = await tx.revision.findFirst({ where: { scriptId, seq } });
    if (!targetRow) throw new EngineError(`修订 #${seq} 不存在`, "not_found");

    const before = await loadSnapshot(scriptId);
    if (!before) throw new EngineError("快照不存在", "not_found");
    const history = await loadHistory(scriptId);
    const target = history.find((r) => r.seq === seq);
    if (!target) throw new EngineError("修订记录缺失", "not_found");

    const check = canUndo(cloneSnapshot(before), history, target, actor.id);
    if (!check.ok) {
      throw new EngineError(check.reason ?? "撤销被拒绝", "undo_denied");
    }

    const inverse = (targetRow.payload as { inverse?: InversePayload }).inverse ?? {};
    const headSeq = before.seq;
    const undoOpId = newId("undo");

    const undoOp: Operation = {
      opId: undoOpId,
      baseSeq: headSeq,
      author: { id: actor.id, name: actor.name },
      body: {
        type: "restoreState",
        reason: `undo:${targetRow.opId}`,
        scenes: inverse.scenes,
        elements: inverse.elements,
        anchors: inverse.anchors,
        ranges: inverse.ranges,
        touched: target.touched.map((t) => ({ kind: t.kind, id: t.id })),
      },
    };

    const head = cloneSnapshot(before);
    // 在事务隔离下直接应用（restoreState 不做三路合并，由上面的 canUndo 保证安全）
    apply(head, undoOp);
    head.seq += 1;

    await persistSnapshot(tx, before, head);

    const touches = touchedBy(undoOp.body, before);
    await tx.revision.create({
      data: {
        scriptId,
        seq: head.seq,
        opId: undoOpId,
        kind: "restoreState",
        authorId: actor.id,
        authorName: actor.name,
        summary: `撤销 #${target.seq}：${target.summary}`,
        baseSeq: headSeq,
        payload: { op: undoOp, inverse: buildCurrentInverse(before, undoOp.body) } as unknown as Prisma.InputJsonValue,
        touched: touches as Prisma.InputJsonValue,
        fingerprints: fingerprints(before, touches) as Prisma.InputJsonValue,
        undoable: true,
      },
    });
    await tx.revision.update({ where: { id: targetRow.id }, data: { undoneBy: undoOpId } });
    await tx.script.update({ where: { id: scriptId }, data: { headSeq: head.seq } });

    logger.info({ target: seq, by: actor.name }, "revision undone");
    return {
      seq: head.seq,
      warnings: check.blockers.map((b) => b.detail),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function buildCurrentInverse(before: Snapshot, body: Operation["body"]) {
  if (body.type !== "restoreState") return {};
  return {
    scenes: before.scenes.filter((x) => (body.scenes ?? []).some((q) => q.id === x.id)),
    elements: before.elements.filter((x) => (body.elements ?? []).some((q) => q.id === x.id)),
    anchors: before.anchors.filter((x) => (body.anchors ?? []).some((q) => q.id === x.id)),
    ranges: before.ranges.filter((x) => (body.ranges ?? []).some((q) => q.id === x.id)),
  };
}

/** 给前端渲染的撤销预检结果 */
export async function previewUndo(scriptId: string, seq: number, actorId: string) {
  const [snap, history] = await Promise.all([loadSnapshot(scriptId), loadHistory(scriptId)]);
  if (!snap) throw new EngineError("脚本不存在", "not_found");
  const target = history.find((r) => r.seq === seq);
  if (!target) throw new EngineError("修订不存在", "not_found");
  return canUndo(snap, history, target, actorId);
}

