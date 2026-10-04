import { useEffect, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { getUserId } from "../api/client";

export default function TopBar() {
  const { script, users, switchUser, queue, lastSyncAt, online } = useEditorStore();
  const [userId, setUserId] = useState(getUserId());

  useEffect(() => {
    const on = () => useEditorStore.setState({ online: true });
    const off = () => useEditorStore.setState({ online: false });
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const pendingCount = queue.length;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-400 text-white shadow-md shadow-indigo-200">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
          </div>
          <div>
            <h1 className="text-sm font-bold leading-tight text-slate-800">协同脚本拆场台</h1>
            <p className="text-[11px] leading-tight text-slate-400">ScriptEditor · 稳定身份 · 显式合并</p>
          </div>
        </div>

        <div className="ml-2 hidden items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-500 md:flex">
          <span>修订</span>
          <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-indigo-600 shadow-sm">
            r{script?.revision ?? "-"}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SyncBadge online={online} pending={pendingCount} lastSyncAt={lastSyncAt} />

          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {users.map((u) => {
              const active = u.id === userId;
              return (
                <button
                  key={u.id}
                  onClick={() => {
                    setUserId(u.id);
                    switchUser(u.id);
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                    active ? "text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"
                  }`}
                  style={active ? { background: u.color } : undefined}
                  title={`以「${u.name}」身份协作`}
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: active ? "rgba(255,255,255,0.25)" : u.color + "22", color: active ? "#fff" : u.color }}
                  >
                    {u.name}
                  </span>
                  {u.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {script && (
        <div className="mx-auto max-w-[1500px] px-5 pb-2">
          <p className="text-[11px] text-slate-400">{script.title} · {script.description}</p>
        </div>
      )}
    </header>
  );
}

function SyncBadge({ online, pending, lastSyncAt }: { online: boolean; pending: number; lastSyncAt: string | null }) {
  if (!online || pending > 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
        {online ? `${pending} 个操作待同步（本地）` : "离线 · 修改仅存本地"}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      云端已同步{lastSyncAt ? ` · ${new Date(lastSyncAt).toLocaleTimeString()}` : ""}
    </div>
  );
}
