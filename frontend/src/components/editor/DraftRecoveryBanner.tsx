import { useEditorStore, patchElement } from "../../store/editorStore";

/**
 * 保存失败后恢复可见草稿。
 * 横幅明确写"本地未同步"，恢复动作会作为一个新操作重新走提交，
 * 绝不把 localStorage 里的内容标记成云端状态。
 */
export default function DraftRecoveryBanner() {
  const { visibleDraft, script, discardVisibleDraft, dispatch } = useEditorStore();
  if (!visibleDraft || !script) return null;

  const target =
    script.scenes.flatMap((s) => s.elements).find((e) => e.id === visibleDraft.elementId) ??
    script.orphanElements.find((e) => e.id === visibleDraft.elementId);

  return (
    <div className="rounded-xl border border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="mt-0.5 text-lg">📝</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-amber-800">
            有一份保存在本机、尚未同步云端的草稿
            <span className="ml-2 rounded bg-amber-200/70 px-1.5 py-0.5 font-mono text-[10px] text-amber-800">
              local-only
            </span>
          </p>
          <p className="mt-1 rounded-lg bg-white/70 p-2 text-[11px] text-slate-600 line-clamp-2">
            {visibleDraft.text}
          </p>
          <p className="mt-1 text-[10px] text-amber-600">
            {target ? `云端当前值：${target.content || "（空）"}` : "原节点可能已被删除，请在待修复中处理"}
            {" · "}保存于 {new Date(visibleDraft.savedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => {
              if (!target) return;
              dispatch(
                {
                  type: "editElement",
                  elementId: target.id,
                  fields: { content: visibleDraft.text },
                  expected: { content: target.content },
                },
                "恢复本地草稿为新提交",
                (s) => patchElement(s, target.id, { content: visibleDraft.text }),
              );
              discardVisibleDraft();
            }}
            disabled={!target}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40"
          >
            作为新修改提交
          </button>
          <button
            onClick={discardVisibleDraft}
            className="rounded-lg border border-amber-300 bg-white/60 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-white"
          >
            丢弃草稿
          </button>
        </div>
      </div>
    </div>
  );
}
