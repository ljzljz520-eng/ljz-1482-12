import { useEditorStore } from "../../store/editorStore";

export default function QueueBar() {
  const { queue, flushQueue, flushing, online } = useEditorStore();
  if (queue.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-amber-800">
          📤 本地待同步队列（{queue.length}）— 这些修改只存在于你的浏览器，尚未写入云端修订
        </span>
        <button
          onClick={flushQueue}
          disabled={flushing || !online}
          className="ml-auto rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {flushing ? "同步中…" : online ? "立即同步" : "离线中…"}
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {queue.map((q) => (
          <li key={q.opId} className="flex items-center gap-2 text-[11px] text-amber-700">
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono">{q.syncState}</span>
            <span>{q.label}</span>
            <span className="ml-auto font-mono text-amber-400">base r{q.baseSeq}</span>
            {q.lastError && <span className="text-rose-500">{q.lastError}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
