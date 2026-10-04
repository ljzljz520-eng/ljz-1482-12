import toast from "react-hot-toast";
import { create } from "zustand";
import { api, ApiError } from "@/api/client";
import type {
  CommitResponse,
  Conflict,
  DocDTO,
  PendingOp,
  PreviewDTO,
  Revision,
  Summary,
} from "@/api/types";

/**
 * 同步状态机（关键：本地草稿永远不能被标记为"云端已同步"除非服务器确实确认该 opId）：
 *  online + queue empty          -> synced
 *  online + queue non-empty      -> pushing
 *  offline                       -> offline-draft（本地持久化，UI 显著提示"未同步"）
 *  提交失败                      -> draft-recoverable（保留可见草稿，可重试）
 */
export type SyncState = "synced" | "pushing" | "offline-draft" | "draft-recoverable" | "loading" | "error";

export interface LogEntry {
  id: string;
  ts: number;
  kind: "info" | "success" | "warn" | "error";
  text: string;
}

const DRAFT_KEY = (scriptId: string, author: string) => `scriptstudio:draft:${scriptId}:${author}`;
const IDENT_KEY = "scriptstudio:identity";

function loadQueue(scriptId: string, author: string): PendingOp[] {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY(scriptId, author)) ?? "[]") as PendingOp[];
  } catch {
    return [];
  }
}
function saveQueue(scriptId: string, author: string, queue: PendingOp[]): void {
  if (queue.length === 0) localStorage.removeItem(DRAFT_KEY(scriptId, author));
  else localStorage.setItem(DRAFT_KEY(scriptId, author), JSON.stringify(queue));
}

let opCounter = 0;
export function newOpId(author: string): string {
  opCounter += 1;
  return `${author}-${Date.now().toString(36)}-${opCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

interface EditorState {
  scriptId: string | null;
  author: string;
  online: boolean;
  sync: SyncState;
  rev: number;
  doc: DocDTO | null;
  preview: PreviewDTO | null;
  previewRev: number;
  revisions: Revision[];
  queue: PendingOp[];
  logs: LogEntry[];
  loading: boolean;
  lastError: string | null;

  setAuthor: (a: string) => void;
  setOnline: (v: boolean) => void;
  load: (scriptId: string) => Promise<void>;
  refreshPreview: () => Promise<void>;
  enqueue: (op: Omit<PendingOp, "opId" | "author" | "baseRev" | "clientTs" | "status"> & { opId?: string }) => string;
  flush: () => Promise<void>;
  retry: () => void;
  discardDraft: () => void;
  requestStalePreview: (delayMs: number) => Promise<void>;
  log: (kind: LogEntry["kind"], text: string) => void;
}

export const useEditor = create<EditorState>((set, get) => {
  const persistQueue = () => {
    const { scriptId, author, queue } = get();
    if (scriptId) saveQueue(scriptId, author, queue);
  };

  const deriveSync = (
    online: boolean,
    queue: PendingOp[],
    loading: boolean,
    lastError: string | null,
  ): SyncState => {
    if (loading) return "loading";
    if (!online) return queue.length ? "offline-draft" : "synced";
    if (queue.some((q) => q.status === "failed")) return "draft-recoverable";
    if (queue.length) return "pushing";
    return lastError ? "error" : "synced";
  };

  const acceptPreview = (preview: PreviewDTO, staleLabel: string) => {
    const cur = get();
    // 节点迁移后旧响应晚到：只有响应修订 >= 已知修订才接受（在闭包外判断，避免 setter 读到旧闭包）
    if (preview.rev < cur.previewRev && cur.preview) {
      get().log("warn", `${staleLabel}（响应 rev=${preview.rev}，当前 rev=${cur.previewRev}），已丢弃，画面保持最新`);
      return;
    }
    set({ preview, previewRev: Math.max(cur.previewRev, preview.rev) });
  };

  const refreshPreview = async () => {
    const { scriptId, online } = get();
    if (!scriptId || !online) return;
    const preview = await api.getPreview(scriptId);
    acceptPreview(preview, "丢弃晚到的旧预览响应");
  };

  return {
    scriptId: null,
    author: localStorage.getItem(IDENT_KEY) ?? "甲",
    online: navigator.onLine,
    sync: "synced",
    rev: 0,
    doc: null,
    preview: null,
    previewRev: 0,
    revisions: [],
    queue: [],
    logs: [],
    loading: false,
    lastError: null,

    setAuthor: (a) => {
      const trimmed = a.trim() || "匿名";
      localStorage.setItem(IDENT_KEY, trimmed);
      const { scriptId } = get();
      set({ author: trimmed, queue: scriptId ? loadQueue(scriptId!, trimmed) : [] });
    },

    setOnline: (v) => {
      set({ online: v });
      get().log(v ? "success" : "warn", v ? "网络已恢复，开始发送本地草稿…" : "已切换为离线模式：操作保存在本地草稿（未同步）");
      if (v) void get().flush();
      else set({ sync: "offline-draft" });
    },

    log: (kind, text) =>
      set((s) => ({
        logs: [{ id: `${Date.now()}-${Math.random()}`, ts: Date.now(), kind, text }, ...s.logs].slice(0, 120),
      })),

    load: async (scriptId) => {
      set({ loading: true, scriptId });
      try {
        const doc = await api.getDoc(scriptId);
        const { revisions } = await api.revisions(scriptId);
        const preview = await api.getPreview(scriptId);
        const author = get().author;
        const queue = loadQueue(scriptId, author);
        set({
          doc,
          rev: doc.rev,
          revisions,
          preview,
          previewRev: preview.rev,
          queue,
          loading: false,
          lastError: null,
          sync: deriveSync(get().online, queue, false, null),
        });
        get().log("info", `已载入脚本，当前修订 rev=${doc.rev}`);
        if (queue.length) {
          get().log("warn", `检测到 ${queue.length} 条未同步本地草稿，已恢复为可见草稿（未标记已同步）`);
          toast(`已恢复 ${queue.length} 条未同步草稿，等待重新提交`, { icon: "📝" });
        }
      } catch (e) {
        set({ loading: false, sync: "error", lastError: (e as Error).message });
        get().log("error", `加载失败：${(e as Error).message}`);
      }
    },

    refreshPreview,

    enqueue: (op) => {
      const { author, rev, scriptId } = get();
      const full: PendingOp = {
        opId: op.opId ?? newOpId(author),
        author,
        type: op.type,
        baseRev: rev,
        payload: op.payload,
        clientTs: Date.now(),
        label: op.label,
        status: "queued",
      };
      set((s) => {
        const queue = [...s.queue, full];
        if (scriptId) saveQueue(scriptId, author, queue);
        return { queue, sync: deriveSync(s.online, queue, false, s.lastError) };
      });
      get().log("info", `已加入本地队列（opId ${full.opId.slice(0, 13)}…）：${full.label}`);
      void get().flush();
      return full.opId;
    },

    flush: async () => {
      const state = get();
      if (!state.online || !state.scriptId) return;
      const next = state.queue.find((q) => q.status === "queued" || q.status === "failed");
      if (!next) return;

      set((s) => ({
        queue: s.queue.map((q) => (q.opId === next.opId ? { ...q, status: "sending" } : q)),
        sync: "pushing",
      }));
      get().log("info", `提交操作到云端：${next.label}`);

      try {
        const res: CommitResponse = await api.commit(state.scriptId, { ...next });
        // —— 服务器确认后才允许移出本地队列；这是"已同步"的唯一判据 ——
        set((s) => {
          const queue = s.queue.filter((q) => q.opId !== next.opId);
          if (state.scriptId) saveQueue(state.scriptId, s.author, queue);
          return { queue, rev: res.rev, lastError: null, sync: deriveSync(s.online, queue, false, null) };
        });

        if (res.duplicate) get().log("info", `断线重连：服务器已有该操作（幂等），沿用 rev=${res.rev}`);
        if (res.rebased) get().log("warn", `操作基于过期 rev=${next.baseRev}，已在 rev=${res.rev} 上显式变基重放，请核对`);

        if (res.result.status === "accepted") {
          get().log("success", `已保存为修订 rev=${res.rev}${res.duplicate ? "（重复提交）" : ""}`);
        } else if (res.result.status === "blocked") {
          get().log("error", `操作被服务端拒绝：${res.result.message ?? res.result.code}（本地草稿已清除，内容未被写入）`);
        } else if (res.result.status === "conflict") {
          get().log("warn", `结构冲突已登记（冲突 ${res.result.conflictId}），请在冲突中心显式裁决`);
        }

        const doc = await api.getDoc(state.scriptId);
        const { revisions } = await api.revisions(state.scriptId);
        const preview = await api.getPreview(state.scriptId);
        acceptPreview(preview, "提交后收到过期预览");
        void get().flush();
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : (e as Error).message;
        set((s) => ({
          queue: s.queue.map((q) => (q.opId === next.opId ? { ...q, status: "failed", error: msg } : q)),
          sync: "draft-recoverable",
          lastError: msg,
        }));
        persistQueue();
        get().log("error", `保存失败：${msg}。草稿仍保留在本地（未标记为已同步），可重试`);
      }
    },

    retry: () => {
      set((s) => ({ queue: s.queue.map((q) => (q.status === "failed" ? { ...q, status: "queued" } : q)) }));
      void get().flush();
    },

    discardDraft: () => {
      set((s) => {
        const queue: PendingOp[] = [];
        if (s.scriptId) saveQueue(s.scriptId, s.author, queue);
        return { queue, sync: deriveSync(s.online, queue, false, null), lastError: null };
      });
      get().log("info", "已放弃本地草稿");
    },

    requestStalePreview: async (delayMs) => {
      const { scriptId } = get();
      if (!scriptId) return;
      get().log("info", `发起一个延迟 ${delayMs}ms 的预览请求，用于制造"旧响应晚到"…`);
      const preview = await api.getPreview(scriptId, { delayMs });
      acceptPreview(preview, "旧预览响应晚到");
    },
  };
});

/** 轮询：模拟多人协作的他人修改推送 */
export function startPolling(scriptId: string, intervalMs = 2500): () => void {
  let stopped = false;
  let timer: number;
  const tick = async () => {
    if (stopped) return;
    const s = useEditor.getState();
    if (s.online && s.scriptId === scriptId) {
      try {
        const doc = await api.getDoc(scriptId);
        const cur = useEditor.getState();
        if (doc.rev > cur.rev) {
          const preview = await api.getPreview(scriptId);
          useEditor.setState({
            doc,
            rev: doc.rev,
            revisions: (await api.revisions(scriptId)).revisions,
          });
          const st = useEditor.getState();
          if (preview.rev >= st.previewRev) {
            useEditor.setState({ preview, previewRev: Math.max(st.previewRev, preview.rev) });
          } else {
            st.log("warn", `轮询收到过期预览（rev=${preview.rev} < 当前 rev=${st.previewRev}），已丢弃`);
          }
          cur.log("info", `检测到协作者的新修订，已更新到 rev=${doc.rev}`);
        }
      } catch {
        /* 轮询失败静默，等下一轮 */
      }
    }
    timer = window.setTimeout(tick, intervalMs);
  };
  void tick();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

export type { Conflict };
