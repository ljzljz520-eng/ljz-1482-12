import { api } from "./client";
import type { ConflictView, RevisionView, ScriptView, User } from "../types/script";

export const scriptApi = {
  users: () => api.get<User[]>("/users").then((r) => r.data),
  get: (id: string) => api.get<ScriptView>(`/scripts/${id}`).then((r) => r.data),
  poll: (id: string, since: number) =>
    api
      .get<{ headSeq: number; changed: boolean; conflictCount: number }>(`/scripts/${id}/poll?since=${since}`)
      .then((r) => r.data),
  revisions: (id: string) => api.get<RevisionView[]>(`/scripts/${id}/revisions`).then((r) => r.data),
  undoCheck: (id: string, seq: number) =>
    api
      .get<{ ok: boolean; reason?: string; blockers: { touch: string; by: string; detail: string }[] }>(
        `/scripts/${id}/revisions/${seq}/undo-check`,
      )
      .then((r) => r.data),
  undo: (id: string, seq: number) => api.post(`/scripts/${id}/revisions/${seq}/undo`).then((r) => r.data),
  conflicts: (id: string) => api.get<ConflictView[]>(`/scripts/${id}/conflicts`).then((r) => r.data),
  resolve: (id: string, cid: string, action: Record<string, unknown>) =>
    api.post(`/scripts/${id}/conflicts/${cid}/resolve`, action).then((r) => r.data),
  saveDraft: (id: string, content: unknown) =>
    api.put(`/scripts/${id}/drafts`, { content }).then((r) => r.data),
  getDraft: (id: string) =>
    api
      .get<{ id: string; status: "draft"; synced: false; content: unknown; updatedAt: string } | null>(
        `/scripts/${id}/drafts`,
      )
      .then((r) => r.data),
};

/** 提交操作：成功/冲突/离线三态 */
export async function commitOp(
  scriptId: string,
  payload: { opId: string; baseSeq: number; body: unknown },
) {
  try {
    const r = await api.post(`/scripts/${scriptId}/commits`, payload);
    return { outcome: "applied" as const, data: r.data as { seq: number; headSeq: number; duplicate?: boolean } };
  } catch (e) {
    const err = e as { response?: { status: number; data: { conflict?: unknown; message?: string } } };
    if (err.response?.status === 409) {
      return { outcome: "conflict" as const, conflict: err.response.data.conflict, message: err.response.data.message };
    }
    if (!err.response) {
      return { outcome: "offline" as const };
    }
    return { outcome: "error" as const, message: err.response.data?.message ?? "提交失败" };
  }
}
