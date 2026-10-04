/**
 * 本地草稿存储（localStorage）。
 * 关键纪律：本地缓存永远标记 "local-only / 未同步"，
 * 只有服务端 commit 成功返回 seq 后才移除——绝不把本地缓存伪装成云端已同步。
 */
import type { PendingOp } from "../types/script";

const KEY = (scriptId: string, userId: string) => `collab:queue:${scriptId}:${userId}`;
const DRAFT_KEY = (scriptId: string, userId: string) => `collab:visible-draft:${scriptId}:${userId}`;

export interface StoredQueueItem extends PendingOp {
  syncState: "local-only" | "retrying";
  lastError?: string;
}

export const queueStore = {
  load(scriptId: string, userId: string): StoredQueueItem[] {
    try {
      return JSON.parse(localStorage.getItem(KEY(scriptId, userId)) || "[]");
    } catch {
      return [];
    }
  },
  save(scriptId: string, userId: string, items: StoredQueueItem[]) {
    localStorage.setItem(KEY(scriptId, userId), JSON.stringify(items));
  },
  clear(scriptId: string, userId: string) {
    localStorage.removeItem(KEY(scriptId, userId));
  },
};

/** 保存失败时可见的编辑草稿（恢复用），与待提交操作队列分开存 */
export interface VisibleDraft {
  text: string;
  elementId: string;
  sceneId: string | null;
  savedAt: string;
  syncState: "local-only";
}

export const draftStore = {
  load(scriptId: string, userId: string): VisibleDraft | null {
    try {
      const raw = localStorage.getItem(DRAFT_KEY(scriptId, userId));
      return raw ? (JSON.parse(raw) as VisibleDraft) : null;
    } catch {
      return null;
    }
  },
  save(scriptId: string, userId: string, draft: Omit<VisibleDraft, "savedAt" | "syncState">) {
    const value: VisibleDraft = { ...draft, savedAt: new Date().toISOString(), syncState: "local-only" };
    localStorage.setItem(DRAFT_KEY(scriptId, userId), JSON.stringify(value));
    return value;
  },
  clear(scriptId: string, userId: string) {
    localStorage.removeItem(DRAFT_KEY(scriptId, userId));
  },
};

export function newOpId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
export function newSceneId(): string {
  return `scene_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
export function newElementId(): string {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
