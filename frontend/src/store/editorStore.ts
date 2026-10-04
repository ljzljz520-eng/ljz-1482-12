import { create } from "zustand";
import toast from "react-hot-toast";
import { commitOp, scriptApi } from "../api/scriptApi";
import { getUserId, setUserId } from "../api/client";
import type {
  ConflictView,
  ElementView,
  OpBody,
  RevisionView,
  SceneView,
  ScriptView,
  User,
} from "../types/script";
import {
  draftStore,
  newOpId,
  queueStore,
  type StoredQueueItem,
  type VisibleDraft,
} from "../utils/localDraft";

const SCRIPT_ID = "demo-script";

interface EditorState {
  script: ScriptView | null;
  revisions: RevisionView[];
  users: User[];
  loading: boolean;
  online: boolean;
  /** 单调请求代际：丢弃晚到的旧快照响应 */
  fetchGeneration: number;
  /** 待提交队列（离线/失败重试） */
  queue: StoredQueueItem[];
  visibleDraft: VisibleDraft | null;
  flushing: boolean;
  lastSyncAt: string | null;
  selectedSceneId: string | null;
  selectedElementId: string | null;
  rightTab: "preview" | "review" | "revisions";
  totalByLocal: number | null;

  load: () => Promise<void>;
  switchUser: (id: string) => Promise<void>;
  setTab: (t: EditorState["rightTab"]) => void;
  select: (sceneId: string | null, elementId?: string | null) => void;

  /** 所有编辑的唯一入口：构造操作 -> 乐观本地态 -> 提交/入队 */
  dispatch: (body: OpBody, label: string, optimistic?: (s: ScriptView) => ScriptView) => Promise<void>;
  flushQueue: () => Promise<void>;
  undo: (seq: number) => Promise<void>;
  resolveConflict: (cid: string, action: Record<string, unknown>) => Promise<void>;
  saveVisibleDraft: (elementId: string, sceneId: string | null, text: string) => void;
  discardVisibleDraft: () => void;
}

function opLabel(body: OpBody): string {
  switch (body.type) {
    case "editElement":
      return `编辑 ${body.elementId}`;
    case "setDuration":
      return `时长 ${body.durationSec}s`;
    case "renameScene":
      return `重命名「${body.title}」`;
    case "splitScene":
      return `拆场 → ${body.newTitle}`;
    case "mergeScenes":
      return `合场 →「${body.mergedTitle}」`;
    case "deleteScene":
      return "删除场次";
    case "deleteElement":
      return "删除元素";
    default:
      return "新增元素";
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  script: null,
  revisions: [],
  users: [],
  loading: true,
  online: navigator.onLine,
  fetchGeneration: 0,
  queue: [],
  visibleDraft: null,
  flushing: false,
  lastSyncAt: null,
  selectedSceneId: null,
  selectedElementId: null,
  rightTab: "preview",
  totalByLocal: null,

  setTab: (t) => set({ rightTab: t }),
  select: (sceneId, elementId = null) =>
    set({ selectedSceneId: sceneId, selectedElementId: elementId }),

  load: async () => {
    const userId = getUserId();
    set((s) => ({
      loading: s.script === null,
      queue: queueStore.load(SCRIPT_ID, userId),
      visibleDraft: draftStore.load(SCRIPT_ID, userId),
    }));
    const gen = get().fetchGeneration + 1;
    set({ fetchGeneration: gen });
    try {
      const [script, revisions, users] = await Promise.all([
        scriptApi.get(SCRIPT_ID),
        scriptApi.revisions(SCRIPT_ID),
        scriptApi.users(),
      ]);
      // 晚到响应保护：只接受最新一代请求的结果
      if (gen !== get().fetchGeneration) return;
      set({
        script,
        revisions,
        users,
        loading: false,
        online: true,
        lastSyncAt: new Date().toISOString(),
        selectedSceneId: get().selectedSceneId ?? script.scenes[0]?.id ?? null,
      });
    } catch {
      if (gen === get().fetchGeneration) set({ loading: false, online: false });
    }
  },

  switchUser: async (id) => {
    setUserId(id);
    set({
      queue: queueStore.load(SCRIPT_ID, id),
      visibleDraft: draftStore.load(SCRIPT_ID, id),
      fetchGeneration: 0,
    });
    await get().load();
  },

  dispatch: async (body, label, optimistic) => {
    const state = get();
    if (!state.script) return;
    const userId = getUserId();
    const item: StoredQueueItem = {
      opId: newOpId(),
      baseSeq: state.script.revision,
      body,
      createdAt: new Date().toISOString(),
      label: label || opLabel(body),
      syncState: "local-only",
    };

    // 乐观更新（立刻可见），但来源明确标注本地
    if (optimistic) {
      set({ script: optimistic(structuredClone(state.script)), totalByLocal: recompute(state.script) });
    }
    const queue = [...state.queue, item];
    queueStore.save(SCRIPT_ID, userId, queue);
    set({ queue });

    await sendOrQueue(item, set, get);
  },

  flushQueue: async () => {
    const { queue, flushing } = get();
    if (flushing || queue.length === 0) return;
    set({ flushing: true });
    try {
      for (const item of [...get().queue]) {
        const r = await commitOp(SCRIPT_ID, { opId: item.opId, baseSeq: item.baseSeq, body: item.body });
        if (r.outcome === "offline") break;
        if (r.outcome === "error") {
          markQueueError(item.opId, r.message ?? "提交失败", set, get);
          break;
        }
        if (r.outcome === "conflict") {
          // 冲突已落服务端待修复，从队列移除（不丢：服务端 MergeConflict 持有原 op）
          removeFromQueue(item.opId, set, get);
          toast("产生协作冲突，已转入右侧「待修复」", { icon: "⚠️" });
        } else {
          removeFromQueue(item.opId, set, get);
        }
      }
      await get().load();
    } finally {
      set({ flushing: false });
    }
  },

  undo: async (seq) => {
    try {
      await scriptApi.undo(SCRIPT_ID, seq);
      toast.success(`已撤销修订 #${seq}`);
      await get().load();
    } catch (e) {
      const data = (e as { response?: { data?: { message?: string } } }).response?.data;
      toast.error(data?.message ?? "撤销失败");
    }
  },

  resolveConflict: async (cid, action) => {
    try {
      const r = await scriptApi.resolve(SCRIPT_ID, cid, action);
      toast.success(r.note ?? "冲突已解决");
      await get().load();
    } catch (e) {
      const data = (e as { response?: { data?: { message?: string } } }).response?.data;
      toast.error(data?.message ?? "解决失败");
    }
  },

  saveVisibleDraft: (elementId, sceneId, text) => {
    const draft = draftStore.save(SCRIPT_ID, getUserId(), { elementId, sceneId, text });
    set({ visibleDraft: draft });
  },
  discardVisibleDraft: () => {
    draftStore.clear(SCRIPT_ID, getUserId());
    set({ visibleDraft: null });
  },
}));

function recompute(s: ScriptView): number {
  return Math.round(
    (s.scenes.reduce((sum, sc) => sum + sc.elements.reduce((a, e) => a + e.durationSec, 0), 0) +
      s.orphanElements.reduce((a, e) => a + e.durationSec, 0)) * 100,
  ) / 100;
}

function removeFromQueue(opId: string, set: (p: Partial<EditorState>) => void, get: () => EditorState) {
  const userId = getUserId();
  const queue = get().queue.filter((q) => q.opId !== opId);
  queueStore.save(SCRIPT_ID, userId, queue);
  set({ queue });
}

function markQueueError(opId: string, message: string, set: (p: Partial<EditorState>) => void, get: () => EditorState) {
  const userId = getUserId();
  const queue = get().queue.map((q) => (q.opId === opId ? { ...q, syncState: "retrying" as const, lastError: message } : q));
  queueStore.save(SCRIPT_ID, userId, queue);
  set({ queue });
}

async function sendOrQueue(
  item: StoredQueueItem,
  set: (p: Partial<EditorState>) => void,
  get: () => EditorState,
) {
  // 提交基版本始终取当前已知 head：服务端会基于 op 原始语义做 rebase，
  // op 自身保存的 baseSeq 仍随修订留痕（rebasedFrom），客户端不做下标变换。
  const headSeq = get().script?.revision ?? item.baseSeq;

  const r = await commitOp(SCRIPT_ID, {
    opId: item.opId,
    baseSeq: headSeq,
    body: item.body,
  });

  if (r.outcome === "applied") {
    removeFromQueue(item.opId, set, get);
    if (r.data.duplicate) {
      toast("重复提交已被幂等去重", { icon: "🔁" });
    }
    await get().load();
  } else if (r.outcome === "conflict") {
    removeFromQueue(item.opId, set, get);
    set({ rightTab: "review" });
    toast("协作冲突：已进入「待修复」等待你显式处理", { icon: "⚠️" });
    await get().load();
  } else if (r.outcome === "offline") {
    markQueueError(item.opId, "离线，等待恢复后同步", set, get);
  } else {
    markQueueError(item.opId, r.message, set, get);
    toast.error(`保存失败：${r.message}（本地草稿仍可见，未标记为已同步）`);
  }
}

/* ---------------- 乐观更新 helpers（按稳定身份修改） ---------------- */

export function patchElement(
  s: ScriptView,
  elementId: string,
  patch: Partial<ElementView>,
): ScriptView {
  return {
    ...s,
    scenes: s.scenes.map((sc) => ({
      ...sc,
      elements: sc.elements.map((e) => (e.id === elementId ? { ...e, ...patch } : e)),
      durationSec:
        patch.durationSec !== undefined
          ? Math.round(sc.elements.reduce((sum, e) => sum + (e.id === elementId ? patch.durationSec! : e.durationSec), 0) * 100) / 100
          : sc.durationSec,
    })),
  };
}

export function optimisticHelpers() {
  return {
    addElement: (s: ScriptView, sceneId: string, el: ElementView): ScriptView => ({
      ...s,
      scenes: s.scenes.map((sc) =>
        sc.id === sceneId
          ? { ...sc, elements: [...sc.elements, el], durationSec: sc.durationSec + el.durationSec }
          : sc,
      ),
      elementCount: s.elementCount + 1,
    }),
    renameScene: (s: ScriptView, sceneId: string, title: string): ScriptView => ({
      ...s,
      scenes: s.scenes.map((sc) => (sc.id === sceneId ? { ...sc, title } : sc)),
    }),
    splitScene: (s: ScriptView, sceneId: string, newId: string, title: string, ids: string[]): ScriptView => {
      const scene = s.scenes.find((sc) => sc.id === sceneId);
      if (!scene) return s;
      const moving = scene.elements.filter((e) => ids.includes(e.id));
      const staying = scene.elements.filter((e) => !ids.includes(e.id));
      const src = { ...scene, elements: staying, durationSec: staying.reduce((a, e) => a + e.durationSec, 0) };
      const fresh: SceneView = {
        id: newId,
        title,
        orderIdx: scene.orderIdx + 512,
        durationSec: moving.reduce((a, e) => a + e.durationSec, 0),
        elements: moving.map((e) => ({ ...e, originSceneId: scene.id, needsReview: true, reviewReason: "刚拆出，等待服务端确认锚点/素材" })),
      };
      const idx = s.scenes.findIndex((sc) => sc.id === sceneId);
      const scenes = [...s.scenes.slice(0, idx), src, fresh, ...s.scenes.slice(idx + 1)];
      return { ...s, scenes };
    },
  };
}
