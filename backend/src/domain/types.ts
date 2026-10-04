/**
 * 协同脚本领域模型 —— 稳定身份版
 *
 * 关键原则：
 * - 场次/元素/字幕锚点/素材区间都有不可变 id，顺序由 orderIdx 决定；
 *   拆场/合场只移动身份，绝不"改数组下标"。
 * - 一切修改都表达为带 opId/baseSeq 的操作意图（Op），服务端线性化为 Revision。
 */

export type ElementKind = "narration" | "dialogue" | "shot";
export type EntityKind = "scene" | "element" | "character";
export type AnchorStatus = "ok" | "broken" | "review";
export type RangeStatus = "ok" | "review";

export interface Character {
  id: string;
  name: string;
  color: string;
  orderIdx: number;
  deletedAt?: string | null;
}

export interface Element {
  id: string;
  sceneId: string | null;
  originSceneId?: string | null;
  kind: ElementKind;
  roleId?: string | null;
  content: string;
  durationSec: number;
  orderIdx: number;
  needsReview?: boolean;
  reviewReason?: string | null;
  deletedAt?: string | null;
}

export interface SubtitleAnchor {
  id: string;
  elementId: string | null;
  targetElementId?: string | null;
  code: string;
  text: string;
  timeMs: number;
  status: AnchorStatus;
  note?: string | null;
  deletedAt?: string | null;
}

export interface MediaRange {
  id: string;
  elementId: string | null;
  assetId: string;
  label: string;
  startMs: number;
  endMs: number;
  status: RangeStatus;
  note?: string | null;
  deletedAt?: string | null;
}

export interface SceneNode {
  id: string;
  orderIdx: number;
  title: string;
  deletedAt?: string | null;
  deleteReason?: string | null;
}

export interface Snapshot {
  scriptId: string;
  seq: number;
  characters: Character[];
  scenes: SceneNode[];
  elements: Element[];
  anchors: SubtitleAnchor[];
  ranges: MediaRange[];
}

export interface Actor {
  id: string;
  name: string;
}

/** 字段编辑（旁白/台词文本、镜头描述、角色） */
export interface EditElementOp {
  type: "editElement";
  elementId: string;
  fields: Partial<Pick<Element, "content" | "roleId" | "durationSec">>;
  /** 客户端读到的旧值；rebase 时用于检测他人是否已改同字段 */
  expected?: Partial<Pick<Element, "content" | "roleId" | "durationSec">>;
}

export interface SetDurationOp {
  type: "setDuration";
  elementId: string;
  durationSec: number;
  expectedDurationSec?: number;
}

export interface RenameSceneOp {
  type: "renameScene";
  sceneId: string;
  title: string;
  expectedTitle?: string;
}

export interface AddElementOp {
  type: "addElement";
  element: Element;
}

export interface DeleteElementOp {
  type: "deleteElement";
  elementId: string;
}

/** 把待归场（sceneId=null）的元素按稳定身份重新挂回某场 */
export interface ReattachElementOp {
  type: "reattachElement";
  elementId: string;
  sceneId: string;
  orderIdx?: number;
}

/** 拆场：保持元素 id 稳定，afterIds 搬到紧邻的新场次 */
export interface SplitSceneOp {
  type: "splitScene";
  sceneId: string;
  newSceneId: string;
  newTitle: string;
  splitAtMs?: number | null;
  afterElementIds: string[];
}

export interface MergeScenesOp {
  type: "mergeScenes";
  sceneIdA: string;
  sceneIdB: string;
  mergedTitle: string;
}

export interface DeleteSceneOp {
  type: "deleteScene";
  reason?: string;
  sceneId: string;
}

/** 内部操作：冲突修复 / undo 用，按身份恢复整组实体 */
export interface RestoreStateOp {
  type: "restoreState";
  reason: string;
  scenes?: SceneNode[];
  elements?: Element[];
  anchors?: SubtitleAnchor[];
  ranges?: MediaRange[];
  /** 被恢复状态所触碰的实体身份，用于指纹 */
  touched?: { kind: EntityKind; id: string }[];
}

export type OpBody =
  | EditElementOp
  | SetDurationOp
  | RenameSceneOp
  | AddElementOp
  | DeleteElementOp
  | ReattachElementOp
  | SplitSceneOp
  | MergeScenesOp
  | DeleteSceneOp
  | RestoreStateOp;

export interface Operation<P extends OpBody = OpBody> {
  opId: string;
  baseSeq: number;
  author: Actor;
  body: P;
  createdAt?: string;
}

/** 字段级冲突 */
export interface FieldConflict {
  type: "field";
  opId: string;
  kind: "field";
  elementId?: string;
  sceneId?: string;
  field: string;
  incoming: unknown;
  existing: unknown;
  base: unknown;
  op: Operation;
}

export type StructuralConflictKind =
  | "split_vs_delete"
  | "merge_vs_delete"
  | "delete_vs_edit"
  | "missing_identity";

export interface StructuralConflict {
  type: StructuralConflictKind;
  opId: string;
  kind: "structural";
  message: string;
  /** 冲突涉及的稳定身份 */
  sceneIds: string[];
  elementIds: string[];
  op: Operation;
}

export type Conflict = FieldConflict | StructuralConflict;

export interface CommitOk {
  status: "applied";
  seq: number;
  rebased: boolean;
  rebasedOnto: number[];
}

export type CommitResult =
  | CommitOk
  | { status: "conflict"; conflict: Conflict };

export interface RevisionRecord {
  seq: number;
  opId: string;
  kind: OpBody["type"];
  author: Actor;
  summary: string;
  baseSeq: number;
  payload: unknown;
  touched: { kind: EntityKind; id: string; field?: string }[];
  fingerprints: Record<string, unknown>;
  rebasedFrom?: number | null;
  rebasedOnto: number[];
  undoable: boolean;
  createdAt: string;
  undoneBy?: string | null;
}
