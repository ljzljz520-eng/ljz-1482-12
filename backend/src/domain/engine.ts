import { nanoid } from "nanoid";
import type {
  Anchor,
  ApplyResult,
  Character,
  Conflict,
  Doc,
  Line,
  Material,
  Operation,
  Scene,
  Shot,
} from "./types.js";
import type { ScriptRepository } from "./repository.js";

export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Snapshot {
  characters: Character[];
  scenes: Scene[];
  lines: Line[];
  shots: Shot[];
  materials: Material[];
  anchors: Anchor[];
  conflicts: Conflict[];
}

const clone = <T>(v: T): T => structuredClone(v);

const activeScenes = (d: Snapshot) =>
  d.scenes
    .filter((s) => !s.deleted)
    .sort((a, b) => a.index - b.index);

function reindex(d: Snapshot): void {
  activeScenes(d).forEach((s, i) => {
    s.index = i;
  });
}

/** 引用完整性：任何时刻所有 line/shot/material/anchor 都必须指向存在的场次。 */
function assertReferentialIntegrity(d: Snapshot): void {
  const sceneIds = new Set(d.scenes.map((s) => s.id));
  for (const l of d.lines) if (!sceneIds.has(l.sceneId)) throw new EngineError("RI_LINE", `台词 ${l.id} 引用了不存在的场次`);
  for (const s of d.shots) if (!sceneIds.has(s.sceneId)) throw new EngineError("RI_SHOT", `镜头 ${s.id} 引用了不存在的场次`);
  for (const m of d.materials) if (!sceneIds.has(m.sceneId)) throw new EngineError("RI_MATERIAL", `素材 ${m.id} 引用了不存在的场次`);
  for (const a of d.anchors) {
    if (!sceneIds.has(a.sceneId)) throw new EngineError("RI_ANCHOR", `字幕锚点 ${a.id} 引用了不存在的场次`);
    const exists =
      (a.refType === "line" && d.lines.some((l) => l.id === a.refId)) ||
      (a.refType === "shot" && d.shots.some((s) => s.id === a.refId));
    if (!exists) throw new EngineError("RI_ANCHOR_REF", `字幕锚点 ${a.id} 的${a.refType}引用已不存在`);
  }
  const charIds = new Set(d.characters.map((c) => c.id));
  for (const l of d.lines) if (l.characterId && !charIds.has(l.characterId)) throw new EngineError("RI_CHAR", `台词 ${l.id} 的角色身份不存在`);
}

function sceneDuration(sceneId: string, d: Snapshot): number {
  return d.shots
    .filter((s) => s.sceneId === sceneId)
    .reduce((sum, s) => sum + (s.needsRepair ? 0 : s.durationMs), 0);
}

export function summarize(doc: Snapshot) {
  // 合计只统计在场（active / pending_repair）场次；pending_orphan 待裁决内容不计入正式合计
  const counted = (s: Scene) => !s.deleted && s.status !== "pending_orphan";
  const scenes = activeScenes(doc).filter(counted).map((s) => ({
    id: s.id,
    index: s.index,
    heading: s.heading,
    status: s.status,
    durationMs: sceneDuration(s.id, doc),
    lineCount: doc.lines.filter((l) => l.sceneId === s.id).length,
    shotCount: doc.shots.filter((x) => x.sceneId === s.id).length,
  }));
  return {
    totalDurationMs: scenes.reduce((a, s) => a + s.durationMs, 0),
    sceneCount: scenes.length,
    pendingRepair:
      doc.lines.filter((x) => x.needsRepair).length +
      doc.shots.filter((x) => x.needsRepair).length +
      doc.materials.filter((x) => x.needsRepair).length +
      doc.anchors.filter((x) => x.needsRepair).length,
    openConflicts: doc.conflicts.filter((c) => c.status === "open").length,
    scenes,
  };
}

const STRUCT_TYPES = new Set(["scene.split", "scene.merge", "scene.delete", "scene.move"]);

/**
 * 协作内核：修订日志 + 乐观并发 + 结构操作显式冲突。
 * apply 是纯函数（不做 IO），便于测试；由 service 在串行事务中调用并持久化。
 */
export function applyOp(doc: Doc, op: Operation): { result: ApplyResult; next: Snapshot } {
  const d: Snapshot = {
    characters: clone(doc.characters),
    scenes: clone(doc.scenes),
    lines: clone(doc.lines),
    shots: clone(doc.shots),
    materials: clone(doc.materials),
    anchors: clone(doc.anchors),
    conflicts: clone(doc.conflicts),
  };
  const rev = doc.headRev;
  const result = dispatch(d, op, rev);
  reindex(d);
  assertReferentialIntegrity(d);
  return { result, next: d };
}

function getScene(d: Snapshot, id: string): Scene {
  const s = d.scenes.find((x) => x.id === id);
  if (!s) throw new EngineError("SCENE_NOT_FOUND", `场次 ${id} 不存在（可能已被他人删除）`);
  return s;
}

function activeScene(d: Snapshot, id: string): Scene {
  const s = getScene(d, id);
  if (s.deleted) throw new EngineError("SCENE_DELETED", "该场次已被删除，无法修改");
  return s;
}

function dispatch(d: Snapshot, op: Operation, rev: number): ApplyResult {
  try {
    switch (op.type) {
      case "edit.field":
        return editField(d, op, rev);
      case "scene.split":
        return splitScene(d, op, rev);
      case "scene.merge":
        return mergeScenes(d, op, rev);
      case "scene.delete":
        return deleteScene(d, op, rev);
      case "scene.move":
        return moveScene(d, op, rev);
      case "repair.resolve":
        return resolveRepair(d, op, rev);
      case "conflict.resolve":
        return resolveConflict(d, op, rev);
      case "undo":
        return undo(d, op, rev);
      default:
        throw new EngineError("UNKNOWN_OP", `未知操作类型 ${String(op.type)}`);
    }
  } catch (e) {
    if (e instanceof EngineError) {
      return { status: "blocked", code: e.code, message: e.message };
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* edit.field                                                          */
/* ------------------------------------------------------------------ */

type EntityKind = "scene" | "line" | "shot" | "material" | "anchor" | "character";

function entityBucket(d: Snapshot, kind: EntityKind) {
  switch (kind) {
    case "scene":
      return d.scenes;
    case "line":
      return d.lines;
    case "shot":
      return d.shots;
    case "material":
      return d.materials;
    case "anchor":
      return d.anchors;
    case "character":
      return d.characters;
  }
}

const ALLOWED_FIELDS: Record<EntityKind, string[]> = {
  scene: ["heading", "narration"],
  line: ["text", "characterId"],
  shot: ["label", "description", "durationMs"],
  material: ["name", "startMs", "endMs"],
  anchor: ["timeMs"],
  character: ["name", "color"],
};

function editField(d: Snapshot, op: Operation, rev: number): ApplyResult {
  const p = op.payload as {
    entityKind?: EntityKind;
    entityId?: string;
    fields?: Record<string, unknown>;
  };
  const kind = p.entityKind;
  if (!kind || !(kind in ALLOWED_FIELDS)) throw new EngineError("BAD_PAYLOAD", "非法实体类型");
  const id = String(p.entityId ?? "");
  const fields = p.fields ?? {};
  const allowed = ALLOWED_FIELDS[kind];
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) throw new EngineError("FIELD_NOT_ALLOWED", `字段 ${key} 不允许直接编辑`);
    const v = fields[key];
    if (typeof v === "string" && v.length > 2000) throw new EngineError("VALUE_TOO_LONG", "文本超出长度限制");
    if (key.endsWith("Ms") && (typeof v !== "number" || !Number.isFinite(v) || v < 0))
      throw new EngineError("BAD_NUMBER", "时长必须是非负数字");
  }
  const bucket = entityBucket(d, kind) as unknown as Array<Record<string, unknown>>;
  const entity = bucket.find((x) => x.id === id);
  if (!entity) throw new EngineError("NOT_FOUND", "目标已不存在，编辑被拒绝（内容未被静默覆盖）");
  if (kind !== "character" && (entity as unknown as Scene).deleted === true)
    throw new EngineError("TARGET_DELETED", "目标已删除，编辑被拒绝");

  // 记录旧值到操作 payload（作为撤销依据与变更证据）
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) before[key] = (entity as Record<string, unknown>)[key] ?? null;
  (op.payload as Record<string, unknown>).before = before;

  for (const [key, value] of Object.entries(fields)) (entity as Record<string, unknown>)[key] = value;
  entity.updatedInRev = rev + 1;
  entity.updatedBy = op.author;
  return { status: "accepted" };
}

/* ------------------------------------------------------------------ */
/* scene.split —— 结构操作：角色/锚点/素材跟随稳定身份，跨切点进待修复 */
/* ------------------------------------------------------------------ */

function splitScene(d: Snapshot, op: Operation, rev: number): ApplyResult {
  const p = op.payload as {
    sceneId?: string;
    headHeading?: string;
    tailHeading?: string;
    /** 切点（镜头边界累计毫秒）；不给定则默认最后一个镜头之后（不产生跨切点） */
    cutMs?: number;
  };
  const src = getScene(d, String(p.sceneId));
  const parentWasDeleted = src.deleted;

  const headId = nanoid();
  const tailId = nanoid();
  const cutMs =
    typeof p.cutMs === "number" && p.cutMs >= 0
      ? p.cutMs
      : d.shots.filter((s) => s.sceneId === src.id).reduce((a, s) => a + s.durationMs, 0);

  const mkChild = (id: string, heading: string): Scene => ({
    id,
    index: 0,
    heading,
    narration: "",
    // 父场已被他人删除时，拆出内容进入隔离待裁决，绝不无声丢失
    status: parentWasDeleted ? "pending_orphan" : "active",
    origin: "split",
    parentSceneId: src.id,
    deleted: false,
    createdInRev: rev + 1,
    createdBy: op.author,
    updatedInRev: rev + 1,
    updatedBy: op.author,
  });
  const head = mkChild(headId, p.headHeading?.trim() || `${src.heading}（上）`);
  const tail = mkChild(tailId, p.tailHeading?.trim() || `${src.heading}（下）`);

  // —— 镜头：按区间累计路由；跨切点的镜头进入待修复（跟随稳定 id 到前半段）——
  let acc = 0;
  const srcShots = d.shots
    .filter((s) => s.sceneId === src.id)
    .sort((a, b) => a.order - b.order);
  for (const shot of srcShots) {
    const start = acc;
    const end = acc + shot.durationMs;
    if (end <= cutMs) {
      shot.sceneId = headId;
    } else if (start >= cutMs) {
      // 镜头只承载时长（无绝对起点），随稳定 id 落到后半段即可
      shot.sceneId = tailId;
    } else {
      shot.sceneId = headId;
      shot.needsRepair = true;
      shot.repairReason = `镜头跨越拆场切点 ${cutMs}ms，请决定保留侧或拆分镜头`;
    }
    acc = end;
  }

  // —— 台词：按客户端选定归属（lineSide），未指定的进待修复 ——
  const sideMap = (p as { lineSide?: Record<string, "head" | "tail"> }).lineSide ?? {};
  const srcLines = d.lines.filter((l) => l.sceneId === src.id).sort((a, b) => a.order - b.order);
  srcLines.forEach((line, i) => {
    const side = sideMap[line.id];
    if (side === "head") line.sceneId = headId;
    else if (side === "tail") line.sceneId = tailId;
    else {
      line.sceneId = headId;
      line.needsRepair = true;
      line.repairReason = "拆场时未指定归属场次";
    }
    line.order = i;
  });

  // —— 素材区间：跟随区间；与切点相交即进待修复（绝不静默裁剪）——
  for (const m of d.materials.filter((x) => x.sceneId === src.id)) {
    if (m.endMs <= cutMs) m.sceneId = headId;
    else if (m.startMs >= cutMs) {
      // 跟随稳定身份迁移到后半段，并把时间线整体平移 -cutMs
      m.sceneId = tailId;
      m.startMs = Math.max(0, m.startMs - cutMs);
      m.endMs = Math.max(m.startMs, m.endMs - cutMs);
    } else {
      m.sceneId = headId;
      m.needsRepair = true;
      m.repairReason = `素材区间跨越拆场切点 ${cutMs}ms`;
    }
  }

  // —— 字幕锚点：跟随其引用实体的稳定身份 ——
  for (const a of d.anchors.filter((x) => x.sceneId === src.id)) {
    if (a.refType === "shot") {
      const shot = d.shots.find((s) => s.id === a.refId);
      a.sceneId = shot?.sceneId ?? headId;
      a.timeMs = shot && shot.sceneId === tailId ? Math.max(0, a.timeMs - cutMs) : a.timeMs;
      if (shot?.needsRepair) {
        a.needsRepair = true;
        a.repairReason = "引用的镜头跨切点待修复";
      }
    } else {
      const line = d.lines.find((l) => l.id === a.refId);
      a.sceneId = line?.sceneId ?? headId;
      if (a.sceneId === tailId) a.timeMs = Math.max(0, a.timeMs - cutMs);
      if (line?.needsRepair) {
        a.needsRepair = true;
        a.repairReason = "引用的台词归属待修复";
      }
    }
  }

  // 角色是全局稳定身份，拆场不复制、不改 id。
  head.narration = src.narration;

  src.deleted = true;
  src.status = "deleted";
  src.updatedInRev = rev + 1;
  src.updatedBy = op.author;

  d.scenes.push(head, tail);
  reindex(d);

  if (parentWasDeleted) {
    return raiseConflict(d, op, rev, "split_deleted_parent", src.id, {
      sceneId: src.id,
      heading: src.heading,
      deletedBy: src.updatedBy,
      children: [head, tail].map((c) => ({ id: c.id, heading: c.heading })),
      message:
        "你拆分的原场次已被他人删除。拆分内容已保留在隔离区，请选择：采用拆分（恢复子场）或采用删除（移除子场，证据保留）。",
    });
  }
  return { status: "accepted" };
}

/* ------------------------------------------------------------------ */
/* scene.merge                                                         */
/* ------------------------------------------------------------------ */

function mergeScenes(d: Snapshot, op: Operation, rev: number): ApplyResult {
  const p = op.payload as { sceneIds?: string[]; heading?: string };
  const ids = p.sceneIds ?? [];
  if (ids.length < 2) throw new EngineError("BAD_PAYLOAD", "合并至少需要两个场次");
  const scenes = ids.map((id) => activeScene(d, id));
  const ordered = [...scenes].sort((a, b) => a.index - b.index);
  // 相邻性校验（基于稳定 id，而非客户端数组下标）
  const active = activeScenes(d);
  const positions = ordered.map((s) => active.findIndex((x) => x.id === s.id));
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] !== positions[i - 1] + 1)
      throw new EngineError("NOT_ADJACENT", "只能合并时间线上相邻的场次");
  }

  const mergedId = nanoid();
  const sources = ordered.map((s) => s.id);
  const merged: Scene = {
    id: mergedId,
    index: 0,
    heading: p.heading?.trim() || `${ordered[0].heading}＋${ordered[ordered.length - 1].heading}`,
    narration: ordered.map((s) => s.narration).filter(Boolean).join("\n"),
    status: "active",
    origin: "merge",
    parentSceneId: null,
    deleted: false,
    createdInRev: rev + 1,
    createdBy: op.author,
    updatedInRev: rev + 1,
    updatedBy: op.author,
  };

  // 记录合并前成员归属（撤销证据）：稳定 id -> 各来源场拥有的引用
  const members: Record<string, { lines: string[]; shots: string[]; materials: string[]; anchors: string[] }> = {};
  for (const s of ordered) {
    members[s.id] = {
      lines: d.lines.filter((x) => x.sceneId === s.id).map((x) => x.id),
      shots: d.shots.filter((x) => x.sceneId === s.id).map((x) => x.id),
      materials: d.materials.filter((x) => x.sceneId === s.id).map((x) => x.id),
      anchors: d.anchors.filter((x) => x.sceneId === s.id).map((x) => x.id),
    };
  }
  (op.payload as Record<string, unknown>).members = members;

  let lineOrder = 0;
  let shotOrder = 0;
  for (const s of ordered) {
    for (const l of d.lines.filter((x) => x.sceneId === s.id).sort((a, b) => a.order - b.order)) {
      l.sceneId = mergedId;
      l.order = lineOrder++;
      // 合并愈合：若待修复原因仅由拆场造成，且引用内容都在合并体内，清除标记
      if (l.needsRepair && l.repairReason?.includes("拆场")) {
        l.needsRepair = false;
        l.repairReason = null;
      }
    }
    for (const sh of d.shots.filter((x) => x.sceneId === s.id).sort((a, b) => a.order - b.order)) {
      sh.sceneId = mergedId;
      sh.order = shotOrder++;
      if (sh.needsRepair && sh.repairReason?.includes("拆场")) {
        sh.needsRepair = false;
        sh.repairReason = null;
      }
    }
  }
  for (const m of d.materials.filter((x) => sources.includes(x.sceneId))) {
    m.sceneId = mergedId;
    if (m.needsRepair && m.repairReason?.includes("拆场")) {
      m.needsRepair = false;
      m.repairReason = null;
    }
  }
  for (const a of d.anchors.filter((x) => sources.includes(x.sceneId))) {
    const ref = a.refType === "line" ? d.lines.find((l) => l.id === a.refId) : d.shots.find((x) => x.id === a.refId);
    a.sceneId = ref?.sceneId ?? mergedId;
    if (a.needsRepair && a.repairReason?.includes("拆场") && ref && !ref.needsRepair) {
      a.needsRepair = false;
      a.repairReason = null;
    }
  }

  for (const s of ordered) {
    s.deleted = true;
    s.status = "deleted";
    s.updatedInRev = rev + 1;
    s.updatedBy = op.author;
  }
  d.scenes.push(merged);
  return { status: "accepted" };
}

/* ------------------------------------------------------------------ */
/* scene.delete —— 与"甲拆场、乙删除原场"显式冲突                      */
/* ------------------------------------------------------------------ */

function deleteScene(d: Snapshot, op: Operation, rev: number): ApplyResult {
  const p = op.payload as { sceneId?: string };
  const target = getScene(d, String(p.sceneId));

  // 该场若已被拆出仍在场的子场 → 删除必须显式裁决，不能静默级联。
  // 父场在拆分时已被软删，因此删除请求可能落在已删除场身上，仍要检查子场。
  const children = d.scenes.filter(
    (s) => s.parentSceneId === target.id && !s.deleted,
  );
  if (children.length > 0) {
    return raiseConflict(d, op, rev, "delete_has_children", target.id, {
      sceneId: target.id,
      heading: target.heading,
      children: children.map((c) => ({ id: c.id, heading: c.heading, status: c.status })),
      message: "该场次已被他人拆分，删除会影响拆出的子场。请选择处理方式，内容不会被静默丢弃。",
    });
  }

  if (!target.deleted) softDelete(d, target);
  return { status: "accepted" };
}

function softDelete(d: Snapshot, target: Scene): void {
  target.deleted = true;
  target.status = "deleted";
  // 内容（台词/镜头/素材/锚点）全部保留，只是随父场进入已删除视图；撤销可完整恢复
}

/* ------------------------------------------------------------------ */
/* scene.move —— 节点迁移，引用靠稳定 id 不跟随下标                    */
/* ------------------------------------------------------------------ */

function moveScene(d: Snapshot, op: Operation, rev: number): ApplyResult {
  const p = op.payload as { sceneId?: string; toIndex?: number };
  const target = activeScene(d, String(p.sceneId));
  const to = Number(p.toIndex);
  const active = activeScenes(d);
  if (!Number.isInteger(to) || to < 0 || to >= active.length)
    throw new EngineError("BAD_PAYLOAD", "目标位置超出范围");
  (op.payload as Record<string, unknown>).fromIndex = active.findIndex((s) => s.id === target.id);
  const without = active.filter((s) => s.id !== target.id);
  without.splice(to, 0, target);
  without.forEach((s, i) => {
    s.index = i;
    s.updatedInRev = rev + 1;
    s.updatedBy = op.author;
  });
  // 所有 line/shot/material/anchor 通过 sceneId 稳定引用，无需任何改动。
  return { status: "accepted" };
}

/* ------------------------------------------------------------------ */
/* repair.resolve —— 用户显式修复待修复引用                            */
/* ------------------------------------------------------------------ */

function resolveRepair(d: Snapshot, op: Operation, rev: number): ApplyResult {
  const p = op.payload as {
    refType?: "line" | "shot" | "material" | "anchor";
    refId?: string;
    fields?: Record<string, unknown>;
    clear?: boolean;
  };
  const buckets = { line: d.lines, shot: d.shots, material: d.materials, anchor: d.anchors } as const;
  const bucket = p.refType ? buckets[p.refType] : undefined;
  if (!bucket) throw new EngineError("BAD_PAYLOAD", "非法待修复引用类型");
  const item = bucket.find((x) => x.id === p.refId) as unknown as Record<string, any> | undefined;
  if (!item) throw new EngineError("NOT_FOUND", "待修复项不存在");
  if (!item.needsRepair) throw new EngineError("NOT_PENDING", "该引用不在待修复状态");

  for (const [k, v] of Object.entries(p.fields ?? {})) {
    if (k === "sceneId") {
      activeScene(d, String(v)); // 修复必须指向存在且在场的场次
      item.sceneId = String(v);
    } else if (k in item) {
      (item as Record<string, unknown>)[k] = v;
    } else {
      throw new EngineError("FIELD_NOT_ALLOWED", `字段 ${k} 不可修改`);
    }
  }
  if (p.clear !== false) {
    item.needsRepair = false;
    item.repairReason = null;
  }
  item.updatedInRev = rev + 1;
  item.updatedBy = op.author;
  return { status: "accepted" };
}

/* ------------------------------------------------------------------ */
/* conflicts                                                           */
/* ------------------------------------------------------------------ */

function raiseConflict(
  d: Snapshot,
  op: Operation,
  rev: number,
  kind: string,
  sceneId: string,
  detail: Record<string, unknown>,
): ApplyResult {
  const c: Conflict = {
    id: nanoid(),
    kind,
    status: "open",
    sceneId,
    detail,
    raisedBy: op.author,
    raisedInRev: rev + 1,
    resolvedBy: null,
    resolvedInRev: null,
    resolution: null,
    createdAt: new Date().toISOString(),
  };
  d.conflicts.push(c);

  // 离线"甲拆场、乙删除原场"：子场被隔离为 pending_orphan（内容保留、不可被普通编辑）
  const children = d.scenes.filter((s) => s.parentSceneId === sceneId && !s.deleted);
  for (const child of children) {
    child.status = "pending_orphan";
    child.updatedInRev = rev + 1;
    child.updatedBy = op.author;
  }
  return { status: "conflict", conflictId: c.id, message: String(detail.message ?? "检测到结构冲突，等待显式裁决") };
}

function resolveConflict(d: Snapshot, op: Operation, rev: number): ApplyResult {
  const p = op.payload as { conflictId?: string; resolution?: string };
  const c = d.conflicts.find((x) => x.id === p.conflictId);
  if (!c) throw new EngineError("CONFLICT_NOT_FOUND", "冲突不存在");
  if (c.status === "resolved") throw new EngineError("ALREADY_RESOLVED", "冲突已裁决");
  const resolution = String(p.resolution);

  const children = d.scenes.filter((s) => s.parentSceneId === c.sceneId);
  const parent = d.scenes.find((s) => s.id === c.sceneId) ?? null;

  if (resolution === "keep_split") {
    // 采用甲的拆分：父场维持删除，子场恢复在场
    for (const child of children) {
      if (child.deleted) continue;
      child.status = "active";
      child.updatedInRev = rev + 1;
      child.updatedBy = op.author;
    }
    if (parent && !parent.deleted) {
      parent.deleted = true;
      parent.status = "deleted";
    }
  } else if (resolution === "keep_delete") {
    // 采用删除：父场与子场都软删除（内容与修订证据全部保留，可追溯）
    for (const child of children) {
      if (!child.deleted) {
        child.deleted = true;
        child.status = "deleted";
        child.updatedInRev = rev + 1;
        child.updatedBy = op.author;
      }
    }
    if (parent && !parent.deleted) {
      parent.deleted = true;
      parent.status = "deleted";
      parent.updatedInRev = rev + 1;
      parent.updatedBy = op.author;
    }
  } else {
    throw new EngineError("BAD_RESOLUTION", "不支持的裁决方式");
  }

  c.status = "resolved";
  c.resolution = resolution;
  c.resolvedBy = op.author;
  c.resolvedInRev = rev + 1;
  return { status: "accepted" };
}

/* ------------------------------------------------------------------ */
/* undo —— 仅反转本人可撤销意图，他人后续修改受保护                     */
/* ------------------------------------------------------------------ */

function undo(d: Snapshot, op: Operation, rev: number): ApplyResult {
  const p = op.payload as { revisionSeq?: number };
  const seq = Number(p.revisionSeq);
  // 历史记录由 service 在校验时注入（引擎内不可见日志）
  const history = (op.payload as { __history?: Array<import("./types.js").CommittedRevision> }).__history;
  const target = history?.find((r) => r.seq === seq);
  if (!target) throw new EngineError("REV_NOT_FOUND", `修订 ${seq} 不存在`);
  if (target.result.status !== "accepted") throw new EngineError("NOT_UNDOABLE", "该修订未成功应用，不可撤销");
  if (target.author !== op.author)
    throw new EngineError("NOT_OWN_INTENT", "只能撤销自己的操作，不能抹去他人的修改");
  if (STRUCT_TYPES.has(target.type) && !isLatestStructural(d, target, history!))
    throw new EngineError("STRUCT_SUPERSEDED", "该结构操作之后又有新的结构变更，请用合并/修复而不是直接撤销");

  switch (target.type) {
    case "edit.field":
      return undoEdit(d, op, target, rev);
    case "scene.split":
      return undoSplit(d, op, target, rev);
    case "scene.merge":
      return undoMerge(d, op, target, rev);
    case "scene.delete":
      return undoDelete(d, op, target, rev);
    case "scene.move":
      return undoMove(d, op, target, history!, rev);
    default:
      throw new EngineError("NOT_UNDOABLE", `${target.type} 不支持撤销`);
  }
}

function isLatestStructural(
  d: Snapshot,
  target: import("./types.js").CommittedRevision,
  history: Array<import("./types.js").CommittedRevision>,
): boolean {
  const later = history.filter((r) => r.seq > target.seq && STRUCT_TYPES.has(r.type) && r.result.status === "accepted");
  return later.length === 0;
}

function undoEdit(
  d: Snapshot,
  op: Operation,
  target: import("./types.js").CommittedRevision,
  rev: number,
): ApplyResult {
  const tp = target.payload as {
    entityKind?: EntityKind;
    entityId?: string;
    fields?: Record<string, unknown>;
    before?: Record<string, unknown>;
  };
  const kind = tp.entityKind!;
  const bucket = entityBucket(d, kind) as unknown as Array<Record<string, unknown>>;
  const entity = bucket.find((x) => x.id === tp.entityId);
  if (!entity) throw new EngineError("TARGET_GONE", "原目标已不存在，无法撤销（请使用冲突中心处理）");
  if (entity.deleted === true) throw new EngineError("TARGET_DELETED", "原目标已被删除，撤销会破坏结构，已拒绝");

  // 他人（或本人的其他意图）在该修订之后改过同一字段 → 拒绝，避免覆盖
  const changedFields = Object.keys(tp.fields ?? {});
  const guards: Array<[string, number, string]> = [];
  for (const f of changedFields) guards.push([f, Number(entity.updatedInRev ?? 0), String(entity.updatedBy ?? "")]);
  for (const [f, updatedInRev, updatedBy] of guards) {
    if (updatedInRev > target.seq && updatedBy !== op.author) {
      throw new EngineError(
        "FIELD_CONCURRENT_CHANGE",
        `字段 ${f} 已被 ${updatedBy} 在修订 ${updatedInRev} 修改，撤销将拒绝以保护其内容`,
      );
    }
    if (updatedInRev > target.seq && updatedBy === op.author) {
      throw new EngineError("FIELD_CHANGED_SINCE", `字段 ${f} 在该操作之后又被修改过，请手动改回需要的值`);
    }
  }
  for (const f of changedFields) {
    const old = tp.before?.[f];
    if (old === undefined) throw new EngineError("NO_EVIDENCE", "缺少旧值证据，无法安全撤销");
    entity[f] = old;
  }
  entity.updatedInRev = rev + 1;
  entity.updatedBy = op.author;
  return { status: "accepted" };
}

function undoSplit(
  d: Snapshot,
  op: Operation,
  target: import("./types.js").CommittedRevision,
  rev: number,
): ApplyResult {
  const parentId = String(target.payload.sceneId);
  const parent = d.scenes.find((s) => s.id === parentId);
  if (!parent) throw new EngineError("PARENT_GONE", "原场次已不存在");
  const children = d.scenes.filter((s) => s.parentSceneId === parentId);
  if (children.length === 0) throw new EngineError("CHILDREN_GONE", "拆出的子场已不存在，无法逆向");

  // 保护：他人在拆分后修改过子场内容 → 拒绝（不能把别人后来写的台词抹掉）
  for (const child of children) {
    for (const l of d.lines.filter((x) => x.sceneId === child.id))
      if (l.updatedInRev > target.seq && l.updatedBy !== op.author)
        throw new EngineError("OTHERS_EDITED_CHILD", `他人 ${l.updatedBy} 已修改拆出场次的台词，撤销已拒绝`);
    for (const sh of d.shots.filter((x) => x.sceneId === child.id))
      if (sh.updatedInRev > target.seq && sh.updatedBy !== op.author)
        throw new EngineError("OTHERS_EDITED_CHILD", `他人 ${sh.updatedBy} 已修改拆出场次的镜头，撤销已拒绝`);
  }
  const openConflict = d.conflicts.find(
    (c) => (c.kind === "delete_has_children" || c.kind === "split_deleted_parent") && c.status === "open" && c.sceneId === parentId,
  );
  if (openConflict) throw new EngineError("CONFLICT_OPEN", "该拆分存在未裁决冲突，请先在冲突中心处理");

  // 逆操作：删除两个子场，恢复父场；内容随稳定 id 回迁
  for (const child of children) {
    for (const l of d.lines.filter((x) => x.sceneId === child.id)) {
      l.sceneId = parentId;
      l.needsRepair = false;
      l.repairReason = null;
    }
    for (const sh of d.shots.filter((x) => x.sceneId === child.id)) {
      sh.sceneId = parentId;
      sh.needsRepair = false;
      sh.repairReason = null;
    }
    for (const m of d.materials.filter((x) => x.sceneId === child.id)) {
      m.sceneId = parentId;
      m.needsRepair = false;
      m.repairReason = null;
    }
    for (const a of d.anchors.filter((x) => x.sceneId === child.id)) {
      const ref = a.refType === "line" ? d.lines.find((l) => l.id === a.refId) : d.shots.find((x) => x.id === a.refId);
      a.sceneId = parentId;
      if (ref && !ref.needsRepair) {
        a.needsRepair = false;
        a.repairReason = null;
      }
    }
    child.deleted = true;
    child.status = "deleted";
  }
  parent.deleted = false;
  parent.status = "active";
  parent.updatedInRev = rev + 1;
  parent.updatedBy = op.author;
  return { status: "accepted" };
}

function undoMerge(
  d: Snapshot,
  op: Operation,
  target: import("./types.js").CommittedRevision,
  rev: number,
): ApplyResult {
  const sourceIds: string[] = (target.payload.sceneIds as string[]) ?? [];
  const sources = sourceIds.map((sid) => d.scenes.find((s) => s.id === sid)!);
  // 找到本次 merge 创建的场（按修订时间与来源匹配）
  const merged = d.scenes.find(
    (s) => s.origin === "merge" && s.createdInRev === target.seq && !s.deleted,
  );
  if (!merged || sources.some((s) => !s)) throw new EngineError("MERGE_GONE", "合并场次或来源场次已不存在");
  // 他人在合并之后修改过合并体内的任何台词/镜头 → 拒绝，保护他人内容
  for (const l of d.lines.filter((x) => x.sceneId === merged.id))
    if (l.updatedInRev > target.seq && l.updatedBy !== op.author)
      throw new EngineError("OTHERS_EDITED_MERGED", "他人已修改合并后的台词，撤销已拒绝");
  for (const sh of d.shots.filter((x) => x.sceneId === merged.id))
    if (sh.updatedInRev > target.seq && sh.updatedBy !== op.author)
      throw new EngineError("OTHERS_EDITED_MERGED", "他人已修改合并后的镜头，撤销已拒绝");

  // 依据合并时写入 payload.members 的证据，把各引用按稳定 id 迁回来源场
  const membership = (target.payload as {
    members?: Record<string, { lines: string[]; shots: string[]; materials: string[]; anchors: string[] }>;
  }).members;
  if (!membership) throw new EngineError("NO_EVIDENCE", "缺少合并成员证据，无法安全撤销");
  for (const src of sources) {
    const mem = membership[src.id];
    if (!mem) continue;
    for (const id of mem.lines) {
      const l = d.lines.find((x) => x.id === id);
      if (l) l.sceneId = src.id;
    }
    for (const id of mem.shots) {
      const sh = d.shots.find((x) => x.id === id);
      if (sh) sh.sceneId = src.id;
    }
    for (const id of mem.materials) {
      const m = d.materials.find((x) => x.id === id);
      if (m) m.sceneId = src.id;
    }
    for (const id of mem.anchors) {
      const a = d.anchors.find((x) => x.id === id);
      if (a) a.sceneId = src.id;
    }
    src.deleted = false;
    src.status = "active";
    src.updatedInRev = rev + 1;
    src.updatedBy = op.author;
  }
  merged.deleted = true;
  merged.status = "deleted";
  return { status: "accepted" };
}

function undoDelete(
  d: Snapshot,
  op: Operation,
  target: import("./types.js").CommittedRevision,
  rev: number,
): ApplyResult {
  const sceneId = String(target.payload.sceneId);
  const scene = d.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new EngineError("SCENE_GONE", "场次已不存在");
  if (!scene.deleted) return { status: "accepted" };
  const openConflict = d.conflicts.find((c) => c.status === "open" && c.sceneId === sceneId);
  if (openConflict) throw new EngineError("CONFLICT_OPEN", "该删除引发的冲突尚未裁决，请先处理冲突");
  scene.deleted = false;
  scene.status = "active";
  scene.updatedInRev = rev + 1;
  scene.updatedBy = op.author;
  return { status: "accepted" };
}

function undoMove(
  d: Snapshot,
  op: Operation,
  target: import("./types.js").CommittedRevision,
  history: Array<import("./types.js").CommittedRevision>,
  rev: number,
): ApplyResult {
  void op;
  void history;
  // 恢复办法：按 target.payload.fromIndex 移回
  const sceneId = String(target.payload.sceneId);
  const fromIndex = Number(target.payload.fromIndex);
  const scene = d.scenes.find((s) => s.id === sceneId);
  if (!scene || scene.deleted) throw new EngineError("SCENE_GONE", "场次已不存在");
  const active = activeScenes(d);
  const without = active.filter((s) => s.id !== sceneId);
  without.splice(Math.min(fromIndex, without.length), 0, scene);
  without.forEach((s, i) => {
    s.index = i;
    s.updatedInRev = rev + 1;
    s.updatedBy = op.author;
  });
  return { status: "accepted" };
}
