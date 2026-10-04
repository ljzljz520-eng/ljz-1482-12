import { useEditorStore } from "../../store/editorStore";

/**
 * 预览卡：数据源与左侧合计是同一个 script 快照（同一 revision）。
 * 晚到响应已在 store.load 的 generation 守卫里丢弃，此处只渲染最新修订。
 */
export default function PreviewPanel() {
  const { script } = useEditorStore();
  if (!script) return null;

  const orphanSec = script.orphanElements.reduce((a, e) => a + e.durationSec, 0);
  let cursor = 0;
  const fmtT = (sec: number) => {
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = (sec % 60).toFixed(1).padStart(4, "0");
    return `${mm}:${ss}`;
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-indigo-700">📺 预览卡（与左侧合计同一修订）</p>
          <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-500 shadow-sm">
            r{script.revision}
          </span>
        </div>
        <p className="mt-1 text-lg font-bold text-slate-800">
          总时长 {fmtT(script.totalDurationSec)} · {script.sceneCount} 场
        </p>
      </div>

      {script.scenes.map((sc) => {
        const start = cursor;
        cursor += sc.durationSec;
        return (
          <div key={sc.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
              <span className="font-mono text-[10px] text-slate-400">{fmtT(start)}</span>
              <span className="text-xs font-semibold text-slate-700">{sc.title}</span>
              <span className="ml-auto text-[10px] text-slate-400">{fmtT(sc.durationSec)}</span>
            </div>
            <ul className="divide-y divide-slate-50">
              {sc.elements.map((el) => (
                <li key={el.id} className="flex gap-2 px-3 py-1.5 text-[11px] leading-relaxed">
                  <span className="mt-0.5 shrink-0 font-mono text-[9px] uppercase text-slate-300">
                    {el.kind === "narration" ? "旁白" : el.kind === "dialogue" ? "台词" : "镜头"}
                  </span>
                  <span className="text-slate-600">{el.content || <em className="text-slate-300">（空）</em>}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {script.orphanElements.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-700">
            待归场节点（{script.orphanElements.length}）· {fmtT(orphanSec)}（已计入上方合计）
          </p>
          <ul className="mt-1 space-y-1">
            {script.orphanElements.map((e) => (
              <li key={e.id} className="text-[11px] text-amber-700">
                {e.content || "(空内容)"}
                {e.reviewReason && <span className="block text-[10px] opacity-75">⚑ {e.reviewReason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
