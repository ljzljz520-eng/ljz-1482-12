import { Wifi, WifiOff, CloudUpload, CloudOff, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import type { SyncState } from "@/store/editorStore";

const SYNC_META: Record<SyncState, { label: string; cls: string; icon: JSX.Element }> = {
  synced: { label: "云端已同步", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 size={13} /> },
  pushing: { label: "正在保存…", cls: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: <Loader2 size={13} className="animate-spin" /> },
  "offline-draft": { label: "离线 · 仅本地草稿（未同步）", cls: "bg-amber-50 text-amber-700 border-amber-200", icon: <CloudOff size={13} /> },
  "draft-recoverable": { label: "保存失败 · 草稿可见可恢复", cls: "bg-rose-50 text-rose-700 border-rose-200", icon: <AlertTriangle size={13} /> },
  loading: { label: "加载中…", cls: "bg-slate-100 text-slate-600 border-slate-200", icon: <Loader2 size={13} className="animate-spin" /> },
  error: { label: "连接异常", cls: "bg-rose-50 text-rose-700 border-rose-200", icon: <AlertTriangle size={13} /> },
};

export default function TopBar() {
  const { author, setAuthor, online, setOnline, sync, rev, doc, queue, retry, discardDraft } = useEditor();

  return (
    <div className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="px-5 py-3 flex flex-wrap items-center gap-3">
        <a href="/" className="text-sm font-semibold text-slate-700 hover:text-indigo-600">
          ← 脚本列表
        </a>
        <div className="h-4 w-px bg-slate-200" />
        <h1 className="text-sm font-semibold text-slate-800 max-w-[280px] truncate">{doc?.title ?? "…"}</h1>
        <span className="badge bg-slate-100 text-slate-500">rev {rev}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className={`badge border ${SYNC_META[sync].cls}`}>
            {SYNC_META[sync].icon}
            {SYNC_META[sync].label}
            {queue.length > 0 && <span className="opacity-70">· {queue.length} 条待发</span>}
          </span>

          {sync === "draft-recoverable" && (
            <>
              <button className="btn-primary !py-1" onClick={retry}>
                <CloudUpload size={14} /> 重试保存
              </button>
              <button className="btn-ghost !py-1 text-rose-500" onClick={discardDraft}>
                放弃草稿
              </button>
            </>
          )}

          <button
            className={`btn !py-1 border ${online ? "border-slate-200 text-slate-600" : "border-amber-300 bg-amber-50 text-amber-700"}`}
            onClick={() => setOnline(!online)}
            title="切换在线/离线（用于验收断线重连）"
          >
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {online ? "在线" : "离线"}
          </button>

          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            身份
            <input
              className="input !py-1 !w-24 text-center"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
