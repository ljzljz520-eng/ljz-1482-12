import { useState } from "react";
import { useEditorStore, optimisticHelpers } from "../../store/editorStore";
import ElementRow from "./ElementRow";
import type { SceneView } from "../../types/script";
import { newElementId, newSceneId } from "../../utils/localDraft";

export default function SceneCard({ scene }: { scene: SceneView }) {
  const { script, dispatch } = useEditorStore();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(scene.title);
  if (!script) return null;

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const doSplit = async () => {
    const ids = [...picked];
    if (ids.length === 0 || ids.length === scene.elements.length) {
      alert("请勾选要迁到新场的节点：至少迁走一个、原场至少保留一个。");
      return;
    }
    const newId = newSceneId();
    const newTitle = `${scene.title}（续）`;
    setPicked(new Set());
    await dispatch(
      { type: "splitScene", sceneId: scene.id, newSceneId: newId, newTitle, afterElementIds: ids },
      `拆场 →「${newTitle}」（${ids.length} 节点）`,
      (s) => optimisticHelpers().splitScene(s, scene.id, newId, newTitle, ids),
    );
  };

  const doMergeNext = async () => {
    const idx = script.scenes.findIndex((s) => s.id === scene.id);
    const next = script.scenes[idx + 1];
    if (!next) return;
    if (!confirm(`把「${next.title}」合并入「${scene.title}」？元素身份全部保留，可撤销。`)) return;
    await dispatch(
      { type: "mergeScenes", sceneIdA: scene.id, sceneIdB: next.id, mergedTitle: `${scene.title}＋${next.title}` },
      `合场「${scene.title}」+「${next.title}」`,
    );
  };

  const commitTitle = async () => {
    setRenaming(false);
    if (!title.trim() || title === scene.title) return;
    await dispatch(
      { type: "renameScene", sceneId: scene.id, title: title.trim(), expectedTitle: scene.title },
      `重命名场次「${title.trim()}」`,
      (s) => optimisticHelpers().renameScene(s, scene.id, title.trim()),
    );
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm transition-shadow hover:shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-slate-700 to-slate-500 text-xs font-bold text-white">
          {String(script.scenes.findIndex((s) => s.id === scene.id) + 1).padStart(2, "0")}
        </span>
        {renaming ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === "Enter" && commitTitle()}
            className="rounded-md border border-indigo-200 px-2 py-1 text-sm font-semibold text-slate-800 outline-none"
          />
        ) : (
          <h3
            onClick={() => {
              setTitle(scene.title);
              setRenaming(true);
            }}
            className="cursor-text rounded-md px-2 py-1 text-sm font-semibold text-slate-800 hover:bg-slate-100"
          >
            {scene.title}
          </h3>
        )}
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{scene.id}</span>
        <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
          {scene.elements.length} 节点 · {Math.round(scene.durationSec * 10) / 10}s
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={doSplit}
            className="rounded-lg bg-indigo-500 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-600 active:scale-95"
          >
            ✂️ 按勾选拆场{picked.size > 0 ? `（${picked.size}）` : ""}
          </button>
          <button
            onClick={doMergeNext}
            disabled={script.scenes.findIndex((s) => s.id === scene.id) === script.scenes.length - 1}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
          >
            ⬅️ 合并下一场
          </button>
          <button
            onClick={async () => {
              const kind = (prompt("新增节点类型：narration（旁白）/ dialogue（台词）/ shot（镜头）", "shot")) as
                | "narration"
                | "dialogue"
                | "shot"
                | null;
              if (!kind || !["narration", "dialogue", "shot"].includes(kind)) return;
              const id = newElementId();
              const orderIdx = (scene.elements[scene.elements.length - 1]?.orderIdx ?? 0) + 1024;
              await dispatch(
                {
                  type: "addElement",
                  element: {
                    id,
                    sceneId: scene.id,
                    originSceneId: scene.id,
                    kind,
                    roleId: kind === "dialogue" ? script.characters[0]?.id ?? null : null,
                    content: "",
                    durationSec: 0,
                    orderIdx,
                  },
                },
                `在「${scene.title}」新增${kind === "narration" ? "旁白" : kind === "dialogue" ? "台词" : "镜头"}`,
                (prev) => {
                  const el: import("../../types/script").ElementView = {
                    id, originSceneId: scene.id, kind,
                    roleId: kind === "dialogue" ? script.characters[0]?.id ?? null : null,
                    content: "", durationSec: 0, orderIdx,
                  };
                  return optimisticHelpers().addElement(prev, scene.id, el);
                },
              );
            }}
            className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:border-indigo-300 hover:text-indigo-500 active:scale-95"
          >
            ＋ 节点
          </button>
          <button
            onClick={() => {
              if (confirm(`删除场次「${scene.title}」？场内节点会进入「待归场」而非消失，可在待修复中处理。`)) {
                dispatch({ type: "deleteScene", sceneId: scene.id, reason: "手动删除场次" }, "删除场次");
              }
            }}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:border-rose-300 hover:text-rose-500 active:scale-95"
          >
            删场
          </button>
        </div>
      </div>

      {picked.size > 0 && (
        <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-[11px] text-indigo-600">
          已勾选 {picked.size} 个节点：拆场时它们会携带自己的稳定 id 迁到新场；相关字幕锚点、素材区间跟随并进入待确认，绝不按数组下标重排。
        </p>
      )}

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {scene.elements.map((el) => (
          <ElementRow key={el.id} element={el} sceneId={scene.id} checked={picked.has(el.id)} onToggleCheck={toggle} />
        ))}
      </div>
    </section>
  );
}
