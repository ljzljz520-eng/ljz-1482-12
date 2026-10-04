import type { CommitResponse, DocDTO, PendingOp, PreviewDTO, Revision } from "./types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.error?.message ?? body?.error?.code ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export const api = {
  listScripts: () => request<{ scripts: Array<{ id: string; title: string; headRev: number }> }>("/scripts"),
  getDoc: (id: string) => request<DocDTO>(`/scripts/${id}`),
  getPreview: (id: string, opts?: { delayMs?: number }) => {
    const q = opts?.delayMs ? `?snapshotAt=1&delayMs=${opts.delayMs}` : "";
    return request<PreviewDTO>(`/scripts/${id}/preview${q}`);
  },
  revisions: (id: string) => request<{ revisions: Revision[] }>(`/scripts/${id}/revisions`),
  commit: (id: string, op: PendingOp) =>
    request<CommitResponse>(`/scripts/${id}/ops`, { method: "POST", body: JSON.stringify(op) }),
  createScript: (title: string) =>
    request<{ id: string; title: string }>("/scripts", { method: "POST", body: JSON.stringify({ title }) }),
};
