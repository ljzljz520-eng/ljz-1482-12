/** 领域模型：稳定身份模型。任何引用都使用 id，数组顺序仅用于展示，不承载身份。 */

export type SceneStatus = "active" | "pending_repair" | "pending_orphan" | "deleted";

export interface Character {
  id: string;
  name: string;
  color: string;
  archived?: boolean;
}

export interface Line {
  id: string;
  sceneId: string;
  order: number;
  characterId: string | null;
  text: string;
  needsRepair: boolean;
  repairReason: string | null;
  createdInRev: number;
  createdBy: string;
  updatedInRev: number;
  updatedBy: string;
}

export interface Shot {
  id: string;
  sceneId: string;
  order: number;
  label: string;
  description: string;
  durationMs: number;
  needsRepair: boolean;
  repairReason: string | null;
  createdInRev: number;
  createdBy: string;
  updatedInRev: number;
  updatedBy: string;
}

export interface Material {
  id: string;
  sceneId: string;
  kind: "video" | "audio" | "image";
  name: string;
  startMs: number;
  endMs: number;
  needsRepair: boolean;
  repairReason: string | null;
  createdInRev: number;
  createdBy: string;
  updatedInRev: number;
  updatedBy: string;
}

export interface Anchor {
  id: string;
  sceneId: string;
  refType: "line" | "shot";
  refId: string;
  timeMs: number;
  needsRepair: boolean;
  repairReason: string | null;
  createdInRev: number;
  createdBy: string;
  updatedInRev: number;
  updatedBy: string;
}

export interface Scene {
  id: string;
  index: number;
  heading: string;
  narration: string;
  status: SceneStatus;
  origin: "seed" | "split" | "merge";
  parentSceneId: string | null;
  deleted: boolean;
  createdInRev: number;
  createdBy: string;
  updatedInRev: number;
  updatedBy: string;
}

export interface Conflict {
  id: string;
  kind: string;
  status: "open" | "resolved";
  sceneId: string | null;
  detail: Record<string, unknown>;
  raisedBy: string;
  raisedInRev: number;
  resolvedBy: string | null;
  resolvedInRev: number | null;
  resolution: string | null;
  createdAt: string;
}

export interface Doc {
  id: string;
  title: string;
  headRev: number;
  characters: Character[];
  scenes: Scene[];
  lines: Line[];
  shots: Shot[];
  materials: Material[];
  anchors: Anchor[];
  conflicts: Conflict[];
}

export type Author = string;

export type OpType =
  | "edit.field"
  | "scene.split"
  | "scene.merge"
  | "scene.delete"
  | "scene.move"
  | "repair.resolve"
  | "conflict.resolve"
  | "undo";

export interface Operation {
  opId: string;
  author: Author;
  type: OpType;
  baseRev: number;
  payload: Record<string, unknown>;
}

export type ApplyStatus = "accepted" | "blocked" | "conflict";

export interface ApplyResult {
  status: ApplyStatus;
  code?: string;
  message?: string;
  conflictId?: string;
  /** 当 baseRev 落后但操作已在更新修订上变基重放时为 true（显式合并非静默） */
  rebased?: boolean;
}

export interface CommittedRevision {
  seq: number;
  opId: string;
  author: string;
  type: OpType;
  baseRev: number;
  payload: Record<string, unknown>;
  result: ApplyResult;
  createdAt: string;
}
