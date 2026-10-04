/**
 * 协同引擎：显式版本冲突 + 三路合并（版本化事件溯源）
*
* 选择该方案而非 OT/CRDT 的理由见 docs/concurrency-choice.md。
* 支持边界：结构操作（拆场/合场/删场）以稳定 id 表达意图，rebase 时
* 在新快照上"按身份重放"，语义无法自动合并时产出显式冲突，绝不静默丢内容。
*/
import {
  type CommitResult,
  type Conflict,
  type Element,
  type EntityKind,
  type Operation,
  type OpBody,
  type RevisionRecord,
  type SceneNode,
  type Snapshot,
  type SubtitleAnchor,
  type MediaRange,
} from "./types.js";

export class EngineError extends Error {
  constructor(
    message: string,
    public code:
      | "not_found"
      | "bad_request"
      | "conflict"
      | "integrity"
      | "undo_denied"
      | "duplicate",
  ) {
    super(message);
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function cloneSnapshot(s: Snapshot): Snapshot {
  return clone(s);
}

export const active = <T extends { deletedAt?: string | null }>(xs: T[]): T[] =>
  xs.filter((x) => !x.deletedAt);

export function orderedScenes(s: Snapshot): SceneNode[] {
  return active(s.scenes).sort((a, b) => a.orderIdx - b.orderIdx);
}

export function orderedElements(s: Snapshot, sceneId: string): Element[] {
  return active(s.elements)
    .filter((e) => e.sceneId === sceneId)
    .sort((a, b) => a.orderIdx - b.orderIdx);
}

export function sceneDurationSec(s: Snapshot, sceneId: string): number {
  return round2(orderedElements(s, sceneId).reduce((sum, e) => sum + (e.durationSec || 0), 0));
}

export function scriptTotalSec(s: Snapshot): number {
  // 包含待归场（sceneId=null）节点：它们仍是脚本内容，只是结构待修复，
  // 保证"合计"与预览/待修复面板口径一致。
  const inScenes = orderedScenes(s).reduce((sum, sc) => sum + sceneDurationSec(s, sc.id), 0);
  const orphans = active(s.elements)
    .filter((e) => e.sceneId === null)
    .reduce((sum, e) => sum + (e.durationSec || 0), 0);
  return round2(inScenes + orphans);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function findScene(s: Snapshot, id: string, allowDeleted = false): SceneNode {
  const sc = s.scenes.find((x) => x.id === id);
  if (!sc || (!allowDeleted && sc.deletedAt)) {
    throw new EngineError(`场次不存在: ${id}`, "not_found");
  }
  return sc;
}

export function findElement(s: Snapshot, id: string, allowDeleted = false): Element {
  const el = s.elements.find((x) => x.id === id);
  if (!el || (!allowDeleted && el.deletedAt)) {
    throw new EngineError(`元素不存在: ${id}`, "not_found");
  }
  return el;
}

/* ------------------------------------------------------------------ */
/* 触碰身份 & 指纹：undo 只反转本人意图，且不能抹掉他人后来的修改        */
/* ------------------------------------------------------------------ */

export type Touch = { kind: EntityKind; id: string; field?: string };

export function touchedBy(body: OpBody, s: Snapshot): Touch[] {
  switch (body.type) {
    case "editElement": {
      const t: Touch[] = Object.keys(body.fields).map((f) => ({
        kind: "element",
        id: body.elementId,
        field: f,
      }));
      return t;
    }
    case "setDuration":
      return [{ kind: "element", id: body.elementId, field: "durationSec" }];
    case "renameScene":
      return [{ kind: "scene", id: body.sceneId, field: "title" }];
    case "addElement":
      return [{ kind: "element", id: body.element.id }];
    case "deleteElement":
      return [{ kind: "element", id: body.elementId }];
    case "reattachElement":
      return [{ kind: "element", id: body.elementId }];
    case "splitScene": {
      const out: Touch[] = [
        { kind: "scene", id: body.sceneId },
        { kind: "scene", id: body.newSceneId },
      ];
      for (const id of body.afterElementIds) out.push({ kind: "element", id });
      // 锚点/区间跟随属于结构性附带触碰
      for (const a of active(s.anchors)) {
        if (a.elementId && body.afterElementIds.includes(a.elementId)) {
          out.push({ kind: "character", id: `anchor:${a.id}` });
        }
      }
      return out;
    }
    case "mergeScenes":
      return [
        { kind: "scene", id: body.sceneIdA },
        { kind: "scene", id: body.sceneIdB },
      ];
    case "deleteScene":
      return [{ kind: "scene", id: body.sceneId }];
    case "restoreState":
      return body.touched ?? [];
  }
}

/** 指纹：实体字段当前值的稳定哈希，供 undo 校验"他人是否后来修改过" */
export function fingerprintOf(s: Snapshot, t: Touch): string {
  const value = (() => {
    if (t.kind === "scene") {
      const sc = s.scenes.find((x) => x.id === t.id);
      if (!sc) return null;
      return t.field ? (sc as unknown as Record<string, unknown>)[t.field] : pick(sc, ["orderIdx", "title", "deletedAt"]);
    }
    if (t.kind === "element") {
      const el = s.elements.find((x) => x.id === t.id);
      if (!el) return null;
      return t.field ? (el as unknown as Record<string, unknown>)[t.field] : pick(el, ["sceneId", "content", "durationSec", "roleId", "deletedAt", "orderIdx"]);
    }
    return null;
  })();
  return stableStringify(value);
}

function pick<T extends object>(o: T, keys: (keyof T)[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k as string] = o[k];
  return out;
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function fingerprints(s: Snapshot, touches: Touch[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of touches) out[`${t.kind}:${t.id}${t.field ? `:${t.field}` : ""}`] = fingerprintOf(s, t);
  return out;
}

/* ------------------------------------------------------------------ */
/* 校验                                                                 */
/* ------------------------------------------------------------------ */

export function validate(s: Snapshot): void {
  const sceneIds = new Set(s.scenes.map((x) => x.id));
  const elemIds = new Set(s.elements.map((x) => x.id));
  const charIds = new Set(active(s.characters).map((x) => x.id));

  for (const e of s.elements) {
    if (e.sceneId !== null && !sceneIds.has(e.sceneId)) {
      throw new EngineError(`引用完整性: 元素 ${e.id} 指向不存在场次 ${e.sceneId}`, "integrity");
    }
    if (e.kind === "dialogue" && e.roleId && !charIds.has(e.roleId)) {
      throw new EngineError(`引用完整性: 台词 ${e.id} 的角色 ${e.roleId} 不存在`, "integrity");
    }
    if (e.durationSec < 0 || Number.isNaN(e.durationSec)) {
      throw new EngineError(`时长非法: ${e.id}`, "integrity");
    }
  }
  for (const a of s.anchors) {
    if (a.elementId && !elemIds.has(a.elementId)) {
      throw new EngineError(`引用完整性: 字幕锚点 ${a.id} 指向不存在元素`, "integrity");
    }
    if (a.targetElementId && !elemIds.has(a.targetElementId)) {
      throw new EngineError(`引用完整性: 锚点 ${a.id} 的目标元素不存在`, "integrity");
    }
  }
  for (const r of s.ranges) {
    if (r.elementId && !elemIds.has(r.elementId)) {
      throw new EngineError(`引用完整性: 素材区间 ${r.id} 指向不存在元素`, "integrity");
    }
    if (!r.deletedAt && r.endMs < r.startMs) {
      throw new EngineError(`素材区间 ${r.id} 结束早于开始`, "integrity");
    }
  }
}

/* ------------------------------------------------------------------ */
/* 应用操作（就地修改可变快照副本）                                      */
/* ------------------------------------------------------------------ */

export function apply(s: Snapshot, op: Operation): void {
  const b = op.body;
  switch (b.type) {
    case "editElement": {
      const el = findElement(s, b.elementId);
      if (b.fields.content !== undefined) el.content = b.fields.content;
      if (b.fields.roleId !== undefined) el.roleId = b.fields.roleId;
      if (b.fields.durationSec !== undefined) el.durationSec = round2(b.fields.durationSec);
      break;
    }
    case "setDuration": {
      const el = findElement(s, b.elementId);
      el.durationSec = round2(b.durationSec);
      break;
    }
    case "renameScene": {
      findScene(s, b.sceneId).title = b.title;
      break;
    }
    case "addElement": {
      const e = clone(b.element);
      const scene = findScene(s, e.sceneId ?? "__none__");
      if (e.orderIdx == null) e.orderIdx = nextOrder(orderedElements(s, scene.id));
      s.elements.push(e);
      break;
    }
    case "reattachElement": {
      const el = findElement(s, b.elementId);
      findScene(s, b.sceneId);
      el.sceneId = b.sceneId;
      el.needsReview = false;
      el.reviewReason = null;
      el.orderIdx = b.orderIdx ?? nextOrder(orderedElements(s, b.sceneId));
      break;
    }
    case "deleteElement": {
      const el = findElement(s, b.elementId);
      el.deletedAt = new Date().toISOString();
      // 引用者进入待修复，而不是悬空或被连带静默删除
      for (const a of s.anchors) {
        if (!a.deletedAt && (a.elementId === el.id || a.targetElementId === el.id)) {
          a.status = "broken";
          a.note = `引用的元素 ${el.id} 已被 ${op.author.name} 删除`;
        }
      }
      for (const r of s.ranges) {
        if (!r.deletedAt && r.elementId === el.id) {
          r.status = "review";
          r.note = `挂载元素 ${el.id} 已删除，等待重新指定`;
        }
      }
      break;
    }
    case "splitScene":
      applySplit(s, op as Operation<Extract<OpBody, { type: "splitScene" }>>);
      break;
    case "mergeScenes":
      applyMerge(s, op as Operation<Extract<OpBody, { type: "mergeScenes" }>>);
      break;
    case "deleteScene": {
      const sc = findScene(s, b.sceneId);
      sc.deletedAt = new Date().toISOString();
      sc.deleteReason = b.reason ?? `被 ${op.author.name} 删除`;
      for (const el of s.elements) {
        if (el.sceneId === sc.id && !el.deletedAt) {
          el.sceneId = null;
          el.needsReview = true;
          el.reviewReason = `所属场次「${sc.title}」被删除，等待重新归场`;
        }
      }
      break;
    }
    case "restoreState":
      applyRestore(s, op as Operation<Extract<OpBody, { type: "restoreState" }>>);
      break;
  }
  validate(s);
}

function nextOrder(xs: { orderIdx: number }[]): number {
  return xs.length ? Math.max(...xs.map((x) => x.orderIdx)) + 1024 : 1024;
}

function applySplit(s: Snapshot, op: Operation<Extract<OpBody, { type: "splitScene" }>>): void {
  const b = op.body;
  const src = findScene(s, b.sceneId);
  if (s.scenes.some((x) => x.id === b.newSceneId)) {
    throw new EngineError(`新场次 id 冲突: ${b.newSceneId}`, "bad_request");
  }
  const kids = orderedElements(s, src.id);
  const moving = new Set(b.afterElementIds);

  if (moving.size !== b.afterElementIds.length) throw new EngineError("拆场元素列表重复", "bad_request");
  for (const id of moving) {
    if (!kids.some((k) => k.id === id)) {
      throw new EngineError(`拆场元素 ${id} 不属于场次 ${src.id} 或不存在`, "not_found");
    }
  }
  if (moving.size === 0 || moving.size === kids.length) {
    throw new EngineError("拆场至少保留一个元素、至少迁走一个元素", "bad_request");
  }

  // 1) 新场次紧跟原场（orderIdx 插值，不重排任何 id）
  const scenes = orderedScenes(s);
  const idx = scenes.findIndex((x) => x.id === src.id);
  const after = scenes[idx + 1];
  const orderIdx = after ? (src.orderIdx + after.orderIdx) / 2 : src.orderIdx + 1024;
  const newScene: SceneNode = { id: b.newSceneId, orderIdx, title: b.newTitle };
  s.scenes.push(newScene);

  // 2) 元素携带原 id 迁移
  for (const el of kids.filter((k) => moving.has(k.id))) {
    el.originSceneId = el.originSceneId ?? src.id;
    el.sceneId = newScene.id;
  }

  // 3) 字幕锚点：引用稳定元素 id，元素已携带 id 迁至新场；锚点仅置待确认
  for (const a of s.anchors) {
    if (a.deletedAt) continue;
    const ref = a.targetElementId ?? a.elementId;
    if (ref && moving.has(ref)) {
      a.status = "review";
      a.note = `拆场迁移：锚点跟随元素 ${ref} 至新场，请确认时间码`;
    }
  }

  // 4) 素材区间：绑定在迁移元素上的跟随；跨越拆分边界的不自动裁剪，进入待修复
  for (const r of s.ranges) {
    if (r.deletedAt) continue;
    if (r.elementId && moving.has(r.elementId)) {
      r.status = "review";
      r.note = `拆场迁移：素材区间跟随元素 ${r.elementId} 至新场，请确认边界`;
    } else if (b.splitAtMs != null && r.startMs < b.splitAtMs && r.endMs > b.splitAtMs) {
      r.status = "review";
      r.note = `素材区间跨越拆分边界 ${b.splitAtMs}ms，禁止自动裁剪，请人工处理`;
    }
  }
}

function applyMerge(s: Snapshot, op: Operation<Extract<OpBody, { type: "mergeScenes" }>>): void {
  const b = op.body;
  const a = findScene(s, b.sceneIdA);
  const scB = findScene(s, b.sceneIdB);
  a.title = b.mergedTitle;

  const base = nextOrder(orderedElements(s, a.id));
  const fromB = orderedElements(s, scB.id);
  fromB.forEach((el, i) => {
    el.sceneId = a.id;
    el.orderIdx = base + i;
  });

  for (const an of s.anchors) {
    if (!an.deletedAt && an.elementId && fromB.some((e) => e.id === an.elementId)) {
      an.status = "review";
      an.note = `合场迁移：锚点跟随元素 ${an.elementId}，请确认时间码`;
    }
  }
  for (const r of s.ranges) {
    if (!r.deletedAt && r.elementId && fromB.some((e) => e.id === r.elementId)) {
      r.status = "review";
      r.note = `合场迁移：素材区间跟随元素 ${r.elementId}，请确认边界`;
    }
  }
  // 被合入场次软删除，身份保留供 undo 指纹与审计
  scB.deletedAt = new Date().toISOString();
  scB.deleteReason = `合并入 ${a.id}`;
}

function applyRestore(s: Snapshot, op: Operation<Extract<OpBody, { type: "restoreState" }>>): void {
  const b = op.body;
  const merge = <T extends { id: string }>(list: T[], incoming: T[] | undefined) => {
    if (!incoming) return;
    for (const item of incoming) {
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = clone(item);
      else list.push(clone(item));
    }
  };
  merge(s.scenes, b.scenes);
  merge(s.elements, b.elements);
  merge(s.anchors, b.anchors as SubtitleAnchor[] | undefined);
  merge(s.ranges, b.ranges as MediaRange[] | undefined);
}

/* ------------------------------------------------------------------ */
/* 三路提交：base(客户端所读) -> incoming op,  onto 当前 head            */
/* ------------------------------------------------------------------ */

export function commit(
  head: Snapshot,
  history: RevisionRecord[],
  op: Operation,
): CommitResult {
  if (op.baseSeq === head.seq) {
    apply(head, op);
    head.seq += 1;
    return { status: "applied", seq: head.seq, rebased: false, rebasedOnto: [] };
  }
  if (op.baseSeq > head.seq) {
    throw new EngineError(`baseSeq ${op.baseSeq} 高于服务端修订 ${head.seq}`, "bad_request");
  }

  // 找到 base 之后、incoming 尚未见过的修订
  const unseen = history.filter((r) => r.seq > op.baseSeq);
  const conflict = detectConflict(head, unseen, op);
  if (conflict) return { status: "conflict", conflict };

  // 无冲突：把意图在新 head 上按稳定身份重放
  apply(head, op);
  head.seq += 1;
  return {
    status: "applied",
    seq: head.seq,
    rebased: true,
    rebasedOnto: unseen.map((r) => r.seq),
  };
}

function detectConflict(head: Snapshot, unseen: RevisionRecord[], op: Operation): Conflict | null {
  const b = op.body;

  // 结构操作：身份仍在是自动重放的前提
  if (b.type === "splitScene") {
    const src = head.scenes.find((x) => x.id === b.sceneId);
    if (!src || src.deletedAt) {
      return structural(
        "split_vs_delete",
        `你拆场时，原场次「${src?.title ?? b.sceneId}」已被他人删除。拆出的元素不会无声丢失，请选择处理方式。`,
        [b.sceneId, b.newSceneId],
        b.afterElementIds,
        op,
      );
    }
    // 并发拆分产生同 id 新场
    if (head.scenes.some((x) => x.id === b.newSceneId)) {
      return structural("missing_identity", "新场次 id 已被并发操作占用", [b.newSceneId], [], op);
    }
    for (const id of b.afterElementIds) {
      const el = head.elements.find((x) => x.id === id);
      if (!el || el.deletedAt) {
        return structural("missing_identity", `待迁移元素 ${id} 已被删除`, [b.sceneId], [id], op);
      }
      if (el.sceneId !== b.sceneId) {
        return structural(
          "split_vs_delete",
          `元素 ${id} 已被并发结构操作移出原场次，无法按原拆场意图迁移`,
          [b.sceneId, el.sceneId ?? ""],
          [id],
          op,
        );
      }
    }
  }

  if (b.type === "mergeScenes") {
    for (const id of [b.sceneIdA, b.sceneIdB]) {
      const sc = head.scenes.find((x) => x.id === id);
      if (!sc || sc.deletedAt) {
        return structural(
          "merge_vs_delete",
          `待合并场次 ${id} 已被他人删除，合并意图需要人工裁决`,
          [b.sceneIdA, b.sceneIdB],
          [],
          op,
        );
      }
    }
  }

  if (b.type === "deleteScene") {
    // 他人在我删除之后编辑过场内元素 -> 显式冲突
    const edited = unseen.filter(
      (r) => r.author.id !== op.author.id &&
      (r.kind === "editElement" || r.kind === "setDuration" || r.kind === "addElement" || r.kind === "deleteElement"),
    );
    const memberIds = new Set(head.elements.filter((e) => e.sceneId === b.sceneId).map((e) => e.id));
    const touchedElems = new Set<string>();
    for (const r of edited) for (const t of r.touched) if (t.kind === "element") touchedElems.add(t.id);
    const hit = [...touchedElems].filter((id) => memberIds.has(id));
    if (hit.length) {
      return structural(
        "delete_vs_edit",
        `你删除场次时，他人刚修改了场内元素 ${hit.join(", ")}，删除会覆盖其修改`,
        [b.sceneId],
        hit,
        op,
      );
    }
  }

  if (b.type === "reattachElement") {
    const el = head.elements.find((x) => x.id === b.elementId);
    if (!el || el.deletedAt) {
      return structural("missing_identity", `待归场元素 ${b.elementId} 已不存在`, [b.sceneId], [b.elementId], op);
    }
    const target = head.scenes.find((x) => x.id === b.sceneId);
    if (!target || target.deletedAt) {
      return structural("merge_vs_delete", `目标场次 ${b.sceneId} 已被删除，无法归场`, [b.sceneId], [b.elementId], op);
    }
  }

  if (b.type === "deleteElement") {
    const el = head.elements.find((x) => x.id === b.elementId);
    if (el && !el.deletedAt) {
      const changed = fieldChangedByOther(unseen, op, "element", b.elementId, ["content", "roleId", "durationSec"]);
      if (changed) {
        return structural(
          "delete_vs_edit",
          `你删除元素 ${b.elementId} 时，他人刚修改了它的 ${changed}`,
          el.sceneId ? [el.sceneId] : [],
          [b.elementId],
          op,
        );
      }
    }
  }

  // 字段级冲突
  if (b.type === "editElement") {
    for (const field of Object.keys(b.fields)) {
      const c = compareField(head, unseen, op, "element", b.elementId, field,
        b.fields[field as keyof typeof b.fields],
        b.expected?.[field as keyof typeof b.expected]);
      if (c) return c;
    }
  }
  if (b.type === "setDuration") {
    const c = compareField(head, unseen, op, "element", b.elementId, "durationSec",
      b.durationSec, b.expectedDurationSec);
    if (c) return c;
  }
  if (b.type === "renameScene") {
    const c = compareField(head, unseen, op, "scene", b.sceneId, "title", b.title, b.expectedTitle);
    if (c) return c;
  }

  // addElement 幂等：同一 opId 已在服务端去重（路由层），此处仅校验场次存在
  return null;
}

function fieldChangedByOther(
  unseen: RevisionRecord[],
  op: Operation,
  kind: EntityKind,
  id: string,
  fields: string[],
): string | null {
  for (const r of unseen) {
    if (r.author.id === op.author.id) continue;
    for (const t of r.touched) {
      if (t.kind === kind && t.id === id && (!t.field || fields.includes(t.field))) {
        return t.field ?? "内容";
      }
    }
  }
  return null;
}

function compareField(
  head: Snapshot,
  unseen: RevisionRecord[],
  op: Operation,
  kind: EntityKind,
  id: string,
  field: string,
  incoming: unknown,
  expected: unknown,
): Conflict | null {
  const touchedByOther = unseen.some(
    (r) =>
      r.author.id !== op.author.id &&
      r.touched.some((t) => t.kind === kind && t.id === id && (!t.field || t.field === field)),
  );
  if (!touchedByOther) return null;

  const container =
    kind === "element"
      ? (head.elements.find((x) => x.id === id) as Record<string, unknown> | undefined)
      : (head.scenes.find((x) => x.id === id) as Record<string, unknown> | undefined);
  const existing = container?.[field];
  if (existing === incoming) return null; // 殊途同归
  if (expected !== undefined && stableStringify(expected) === stableStringify(existing)) {
    // 他人碰过但值恰好回到我基线值：安全
    return null;
  }
  return {
    type: "field",
    opId: op.opId,
    kind: "field",
    elementId: kind === "element" ? id : undefined,
    sceneId: kind === "scene" ? id : undefined,
    field,
    incoming,
    existing,
    base: expected,
    op,
  };
}

function structural(
  type: Conflict["type"],
  message: string,
  sceneIds: string[],
  elementIds: string[],
  op: Operation,
): Conflict {
  return {
    type: type as Exclude<Conflict["type"], "field">,
    opId: op.opId,
    kind: "structural",
    message,
    sceneIds: sceneIds.filter(Boolean),
    elementIds,
    op,
  } as Conflict;
}

/* ------------------------------------------------------------------ */
/* Undo：仅本人、仅可撤销、指纹未被他人改写                              */
/* ------------------------------------------------------------------ */

export interface UndoCheck {
  ok: boolean;
  reason?: string;
  blockers: { touch: string; by: string; detail: string }[];
}

export function canUndo(
  head: Snapshot,
  history: RevisionRecord[],
  target: RevisionRecord,
  actorId: string,
): UndoCheck {
  if (target.author.id !== actorId) {
    return { ok: false, reason: "只能撤销本人的操作", blockers: [] };
  }
  if (!target.undoable || target.undoneBy) {
    return { ok: false, reason: "该修订不可撤销或已撤销", blockers: [] };
  }
  const later = history.filter((r) => r.seq > target.seq);
  const blockers: UndoCheck["blockers"] = [];
  for (const t of target.touched) {
    const key = `${t.kind}:${t.id}${t.field ? `:${t.field}` : ""}`;
    const since = later.find((r) =>
      r.touched.some((rt) =>
        `${rt.kind}:${rt.id}${rt.field ? `:${rt.field}` : ""}` === key ||
        // 结构操作触碰整个实体，覆盖其字段级指纹
        (!rt.field && `${rt.kind}:${rt.id}` === `${t.kind}:${t.id}`),
      ),
    );
    if (since) {
      // 本人后续修改：允许撤销但会一并提示；他人修改：硬阻断
      const mine = since.author.id === actorId;
      const current = fingerprintOf(head, t);
      if (!mine || current !== target.fingerprints[key]) {
        blockers.push({
          touch: key,
          by: since.author.name,
          detail: mine
            ? "你之后又改过它，撤销将恢复到本次操作前的值"
            : `他人 ${since.author.name} 在你之后修改过，撤销会抹掉其内容，已阻止`,
        });
      }
    }
  }
  const hard = blockers.filter((b) => b.detail.includes("已阻止"));
  return hard.length ? { ok: false, reason: "存在他人后续修改", blockers } : { ok: true, blockers };
}

/** 构造反转操作（restoreState 携带目标修订前快照，服务端按身份恢复） */
export function buildUndoOp(target: RevisionRecord, undoOpId: string, headSeq: number, actorId: string): Operation {
  // 恢复数据在服务层从 fingerprints + 历史生成（需要完整历史快照），
  // 引擎只保证操作壳的合法性。
  void actorId;
  return {
    opId: undoOpId,
    baseSeq: headSeq,
    author: target.author,
    body: {
      type: "restoreState",
      reason: `undo:${target.opId}`,
      touched: target.touched.map((t) => ({ kind: t.kind, id: t.id })),
    },
  };
}
