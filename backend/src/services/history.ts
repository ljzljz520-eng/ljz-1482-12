import { prisma } from "../lib/prisma.js";
import type { Actor, OpBody, RevisionRecord } from "../domain/types.js";
import type { Touch } from "../domain/engine.js";

export function summarize(body: OpBody): string {
  switch (body.type) {
    case "editElement":
      return `编辑元素 ${body.elementId} 的 ${Object.keys(body.fields).join("、")}`;
    case "setDuration":
      return `调整元素 ${body.elementId} 时长为 ${body.durationSec}s`;
    case "renameScene":
      return `重命名场次为「${body.title}」`;
    case "addElement":
      return `新增${kindLabel(body.element.kind)} ${body.element.id}`;
    case "deleteElement":
      return `删除元素 ${body.elementId}`;
    case "reattachElement":
      return `节点 ${body.elementId} 重新归场至 ${body.sceneId}`;
    case "splitScene":
      return `拆场：${body.sceneId} → ${body.newSceneId}（迁走 ${body.afterElementIds.length} 个元素）`;
    case "mergeScenes":
      return `合场：${body.sceneIdA} + ${body.sceneIdB} →「${body.mergedTitle}」`;
    case "deleteScene":
      return `删除场次 ${body.sceneId}`;
    case "restoreState":
      return `状态恢复（${body.reason}）`;
  }
}

function kindLabel(k: string): string {
  return k === "narration" ? "旁白" : k === "dialogue" ? "台词" : "镜头";
}

export async function loadHistory(scriptId: string): Promise<RevisionRecord[]> {
  const rows = await prisma.revision.findMany({
    where: { scriptId },
    orderBy: { seq: "asc" },
  });
  return rows.map<RevisionRecord>((r) => ({
    seq: r.seq,
    opId: r.opId,
    kind: r.kind as RevisionRecord["kind"],
    author: { id: r.authorId, name: r.authorName },
    summary: r.summary,
    baseSeq: r.baseSeq,
    payload: r.payload,
    touched: r.touched as Touch[],
    fingerprints: r.fingerprints as Record<string, string>,
    rebasedFrom: r.rebasedFrom,
    rebasedOnto: r.rebasedOnto,
    undoable: r.undoable,
    createdAt: r.createdAt.toISOString(),
    undoneBy: r.undoneBy,
  }));
}

export function toActor(r: RevisionRecord): Actor {
  return r.author;
}
