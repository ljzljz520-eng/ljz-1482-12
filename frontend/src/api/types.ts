export type SceneStatus = "active" | "pending_repair" | "pending_orphan" | "deleted";

export interface Character {
  id: string;
  name: string;
  color: string;
  archived?: boolean;
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

export interface Line {
  id: string;
  sceneId: string;
  order: number;
  characterId: string | null;
  text: string;
  needsRepair: boolean;
  repairReason: string | null;
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
}

export interface Anchor {
  id: string;
  sceneId: string;
  refType: "line" | "shot";
  refId: string;
  timeMs: number;
  needsRepair: boolean;
  repairReason: string | null;
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

export interface DocDTO {
  scriptId: string;
  title: string;
  rev: number;
  characters: Character[];
  conflicts: Conflict[];
  scenes: Scene[];
  lines: Line[];
  shots: Shot[];
  materials: Material[];
  anchors: Anchor[];
  summary: Summary;
}

export interface Summary {
  totalDurationMs: number;
  sceneCount: number;
  pendingRepair: number;
  openConflicts: number;
  scenes: Array<{
    id: string;
    index: number;
    heading: string;
    status: SceneStatus;
    durationMs: number;
    lineCount: number;
    shotCount: number;
  }>;
}

export interface PreviewScene {
  id: string;
  no: number;
  heading: string;
  narration: string;
  status: SceneStatus;
  sceneDurationMs?: number;
  lines: Array<{
    id: string;
    characterId: string | null;
    characterName: string | null;
    text: string;
    needsRepair: boolean;
    repairReason: string | null;
  }>;
  shots: Array<{ id: string; label: string; description: string; durationMs: number; needsRepair: boolean; repairReason: string | null }>;
  materials: Material[];
  anchors: Anchor[];
}

export interface PreviewDTO {
  scriptId: string;
  title: string;
  rev: number;
  stale?: boolean;
  summary: Summary;
  characters: Character[];
  conflicts: Conflict[];
  scenes: PreviewScene[];
}

export interface Revision {
  seq: number;
  opId: string;
  author: string;
  type: string;
  baseRev: number;
  payload: Record<string, any>;
  result: { status: "accepted" | "blocked" | "conflict"; code?: string; message?: string; conflictId?: string; rebased?: boolean };
  createdAt: string;
}

export type OpType =
  | "edit.field"
  | "scene.split"
  | "scene.merge"
  | "scene.delete"
  | "scene.move"
  | "repair.resolve"
  | "conflict.resolve"
  | "undo";

export interface PendingOp {
  opId: string;
  author: string;
  type: OpType;
  baseRev: number;
  payload: Record<string, unknown>;
  clientTs: number;
  label: string;
  status: "queued" | "sending" | "failed";
  error?: string;
}

export interface CommitResponse {
  rev: number;
  opId: string;
  result: Revision["result"];
  rebased: boolean;
  duplicate: boolean;
  summary: Summary | null;
  openConflict: string | null;
}
