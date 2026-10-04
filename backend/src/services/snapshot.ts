/**
 * 快照装载与持久化。
 * 表中保留软删除行（墓碑），装载时 deletedAt 一并带出；顺序只由 orderIdx 决定。
 */
import { prisma } from "../lib/prisma.js";
import type {
  Character,
  Element,
  MediaRange,
  SceneNode,
  Snapshot,
  SubtitleAnchor,
} from "../domain/types.js";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function loadSnapshot(scriptId: string): Promise<Snapshot | null> {
  const script = await prisma.script.findUnique({ where: { id: scriptId } });
  if (!script) return null;

  const [scenes, elements, characters, anchors, ranges] = await Promise.all([
    prisma.sceneNode.findMany({ where: { scriptId } }),
    prisma.element.findMany({ where: { scriptId } }),
    prisma.character.findMany({ where: { scriptId } }),
    prisma.subtitleAnchor.findMany({ where: { scriptId } }),
    prisma.mediaRange.findMany({ where: { scriptId } }),
  ]);

  return {
    scriptId,
    seq: script.headSeq,
    characters: characters.map<Character>((c) => ({
      id: c.id, name: c.name, color: c.color, orderIdx: c.orderIdx, deletedAt: iso(c.deletedAt),
    })),
    scenes: scenes.map<SceneNode>((s) => ({
      id: s.id, orderIdx: s.orderIdx, title: s.title,
      deletedAt: iso(s.deletedAt), deleteReason: s.deleteReason,
    })),
    elements: elements.map<Element>((e) => ({
      id: e.id,
      sceneId: e.sceneId,
      originSceneId: e.originSceneId,
      kind: e.kind as Element["kind"],
      roleId: e.roleId,
      content: e.content,
      durationSec: e.durationSec,
      orderIdx: e.orderIdx,
      needsReview: e.needsReview,
      reviewReason: e.reviewReason,
      deletedAt: iso(e.deletedAt),
    })),
    anchors: anchors.map<SubtitleAnchor>((a) => ({
      id: a.id, elementId: a.elementId, targetElementId: a.targetElementId,
      code: a.code, text: a.text, timeMs: a.timeMs,
      status: a.status as SubtitleAnchor["status"], note: a.note, deletedAt: iso(a.deletedAt),
    })),
    ranges: ranges.map<MediaRange>((r) => ({
      id: r.id, elementId: r.elementId, assetId: r.assetId, label: r.label,
      startMs: r.startMs, endMs: r.endMs,
      status: r.status as MediaRange["status"], note: r.note, deletedAt: iso(r.deletedAt),
    })),
  };
}

/** 把引擎应用后的快照差异写回（按稳定 id upsert；不删除任何身份） */
export async function persistSnapshot(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  before: Snapshot,
  after: Snapshot,
): Promise<void> {
  const beforeMaps = {
    scenes: new Map(before.scenes.map((x) => [x.id, x])),
    elements: new Map(before.elements.map((x) => [x.id, x])),
    anchors: new Map(before.anchors.map((x) => [x.id, x])),
    ranges: new Map(before.ranges.map((x) => [x.id, x])),
  };

  for (const sc of after.scenes) {
    const old = beforeMaps.scenes.get(sc.id);
    const data = {
      scriptId: after.scriptId,
      orderIdx: sc.orderIdx,
      title: sc.title,
      deletedAt: sc.deletedAt ? new Date(sc.deletedAt) : null,
      deleteReason: sc.deleteReason ?? null,
    };
    if (!old) {
      await tx.sceneNode.create({ data: { id: sc.id, ...data } });
    } else if (JSON.stringify(old) !== JSON.stringify(sc)) {
      await tx.sceneNode.update({ where: { id: sc.id }, data });
    }
  }

  for (const el of after.elements) {
    const old = beforeMaps.elements.get(el.id);
    const data = {
      scriptId: after.scriptId,
      sceneId: el.sceneId,
      originSceneId: el.originSceneId ?? null,
      kind: el.kind,
      roleId: el.roleId ?? null,
      content: el.content,
      durationSec: el.durationSec,
      orderIdx: el.orderIdx,
      needsReview: el.needsReview ?? false,
      reviewReason: el.reviewReason ?? null,
      deletedAt: el.deletedAt ? new Date(el.deletedAt) : null,
    };
    if (!old) {
      await tx.element.create({ data: { id: el.id, ...data } });
    } else if (JSON.stringify(old) !== JSON.stringify(el)) {
      await tx.element.update({ where: { id: el.id }, data });
    }
  }

  for (const a of after.anchors) {
    const old = beforeMaps.anchors.get(a.id);
    const data = {
      scriptId: after.scriptId,
      elementId: a.elementId,
      targetElementId: a.targetElementId ?? null,
      code: a.code,
      text: a.text,
      timeMs: a.timeMs,
      status: a.status,
      note: a.note ?? null,
      deletedAt: a.deletedAt ? new Date(a.deletedAt) : null,
    };
    if (!old) {
      await tx.subtitleAnchor.create({ data: { id: a.id, ...data } });
    } else if (JSON.stringify(old) !== JSON.stringify(a)) {
      await tx.subtitleAnchor.update({ where: { id: a.id }, data });
    }
  }

  for (const r of after.ranges) {
    const old = beforeMaps.ranges.get(r.id);
    const data = {
      scriptId: after.scriptId,
      elementId: r.elementId,
      assetId: r.assetId,
      label: r.label,
      startMs: r.startMs,
      endMs: r.endMs,
      status: r.status,
      note: r.note ?? null,
      deletedAt: r.deletedAt ? new Date(r.deletedAt) : null,
    };
    if (!old) {
      await tx.mediaRange.create({ data: { id: r.id, ...data } });
    } else if (JSON.stringify(old) !== JSON.stringify(r)) {
      await tx.mediaRange.update({ where: { id: r.id }, data });
    }
  }
}
