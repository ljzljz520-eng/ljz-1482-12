export type ElementKind = "narration" | "dialogue" | "shot";

export interface User {
  id: string;
  name: string;
  color: string;
}

export interface Character {
  id: string;
  name: string;
  color: string;
}

export interface ElementView {
  id: string;
  kind: ElementKind;
  roleId: string | null;
  content: string;
  durationSec: number;
  orderIdx: number;
  needsReview?: boolean;
  reviewReason?: string | null;
  originSceneId?: string | null;
}

export interface SceneView {
  id: string;
  title: string;
  orderIdx: number;
  durationSec: number;
  elements: ElementView[];
}

export interface AnchorView {
  id: string;
  elementId: string | null;
  targetElementId?: string | null;
  code: string;
  text: string;
  timeMs: number;
  status: "ok" | "broken" | "review";
  note?: string | null;
}

export interface RangeView {
  id: string;
  elementId: string | null;
  assetId: string;
  label: string;
  startMs: number;
  endMs: number;
  status: "ok" | "review";
  note?: string | null;
}

export interface ConflictView {
  id: string;
  opId: string;
  kind: string;
  status: string;
  author: { id: string; name: string };
  baseSeq: number;
  op: unknown;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ScriptView {
  id: string;
  title: string;
  description: string;
  revision: number;
  updatedAt: string;
  totalDurationSec: number;
  sceneCount: number;
  elementCount: number;
  characters: Character[];
  scenes: SceneView[];
  orphanElements: ElementView[];
  reviewItems: {
    anchors: AnchorView[];
    ranges: RangeView[];
  };
  pendingConflicts: ConflictView[];
}

export interface RevisionView {
  seq: number;
  opId: string;
  kind: string;
  author: { id: string; name: string };
  summary: string;
  baseSeq: number;
  rebasedFrom: number | null;
  rebasedOnto: number[];
  undoable: boolean;
  undoneBy: string | null;
  touched: { kind: string; id: string; field?: string }[];
  createdAt: string;
}

/** 客户端发送的操作（与后端 Zod schema 对齐） */
export type OpBody =
  | { type: "editElement"; elementId: string; fields: { content?: string; roleId?: string | null; durationSec?: number }; expected?: Record<string, unknown> }
  | { type: "setDuration"; elementId: string; durationSec: number; expectedDurationSec?: number }
  | { type: "renameScene"; sceneId: string; title: string; expectedTitle?: string }
  | { type: "addElement"; element: unknown }
  | { type: "deleteElement"; elementId: string }
  | { type: "reattachElement"; elementId: string; sceneId: string }
  | { type: "splitScene"; sceneId: string; newSceneId: string; newTitle: string; splitAtMs?: number | null; afterElementIds: string[] }
  | { type: "mergeScenes"; sceneIdA: string; sceneIdB: string; mergedTitle: string }
  | { type: "deleteScene"; sceneId: string; reason?: string };

export interface PendingOp {
  opId: string;
  body: OpBody;
  baseSeq: number;
  createdAt: string;
  /** 本地可见草稿的摘要 */
  label: string;
}
