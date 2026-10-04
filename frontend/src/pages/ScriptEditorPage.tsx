import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import TopBar from "../components/TopBar";
import StatsBar from "../components/editor/StatsBar";
import QueueBar from "../components/editor/QueueBar";
import SceneCard from "../components/editor/SceneCard";
import DraftRecoveryBanner from "../components/editor/DraftRecoveryBanner";
import PreviewPanel from "../components/panels/PreviewPanel";
import ConflictPanel from "../components/panels/ConflictPanel";
import RevisionsPanel from "../components/panels/RevisionsPanel";
import { scriptApi } from "../api/scriptApi";
import Skeleton from "../components/Skeleton";

const SCRIPT_ID = "demo-script";

export default function ScriptEditorPage() {
  const { script, loading, load, rightTab, setTab, flushQueue, queue } = useEditorStore();
  const pollRef = useRef<number>();

  useEffect(() => {
    load();
  }, [load]);

  // 协作轮询：headSeq 变化才全量刷新；断线恢复后自动 flush
  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const current = useEditorStore.getState();
        const p = await scriptApi.poll(SCRIPT_ID, current.script?.revision ?? 0);
        useEditorStore.setState({ online: true });
        if (p.changed) await current.load();
        if (navigator.onLine && current.queue.length > 0 && !current.flushing) {
          current.flushQueue();
        }
      } catch {
        useEditorStore.setState({ online: false });
      }
    }, 3000);
    pollRef.current = timer;
    return () => window.clearInterval(timer);
  }, []);

  // 浏览器重新联网立刻补提交
  useEffect(() => {
    const onOnline = () => {
      useEditorStore.setState({ online: true });
      flushQueue();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushQueue]);

  const pendingCount = queue.length;
  const tabs = [
    { id: "preview" as const, label: "预览", badge: 0 },
    { id: "review" as const, label: "待修复", badge: script?.pendingConflicts.length ?? 0 },
    { id: "revisions" as const, label: "修订", badge: 0 },
  ];

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-[1500px] px-5 py-4">
        {loading || !script ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
              <Skeleton className="h-[500px]" />
              <Skeleton className="h-[500px]" />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <StatsBar />
            <DraftRecoveryBanner />
            <QueueBar />

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
              {/* 左：场次时间线 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <h2 className="text-sm font-bold text-slate-700">场次时间线</h2>
                  <span className="text-[11px] text-slate-400">
                    勾选节点 → 拆场；顺序由稳定 orderIdx 决定，结构操作只移动身份
                  </span>
                  {pendingCount > 0 && (
                    <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      {pendingCount} 待同步
                    </span>
                  )}
                </div>
                {script.scenes.map((sc) => (
                  <SceneCard key={sc.id} scene={sc} />
                ))}
                {script.scenes.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
                    暂无场次（可能全部被删除，可在右侧修订中撤销）
                  </div>
                )}
              </div>

              {/* 右：预览 / 待修复 / 修订 */}
              <aside className="lg:sticky lg:top-[104px] lg:h-[calc(100vh-120px)]">
                <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white/70 shadow-sm">
                  <div className="flex gap-1 border-b border-slate-100 p-1.5">
                    {tabs.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                          rightTab === t.id ? "bg-slate-800 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        {t.label}
                        {t.badge > 0 && (
                          <span className="rounded-full bg-rose-500 px-1.5 text-[9px] font-bold text-white">{t.badge}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 space-y-3 overflow-y-auto p-3">
                    {rightTab === "preview" && <PreviewPanel />}
                    {rightTab === "review" && <ConflictPanel />}
                    {rightTab === "revisions" && <RevisionsPanel />}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>
      <footer className="mx-auto max-w-[1500px] px-5 py-6 text-center text-[11px] text-slate-400">
        协同方案：版本化修订 + 显式三路合并（对比 OT / CRDT 的选型见 docs/concurrency-choice.md）·
        服务端 Serializable 事务校验引用完整性 · 本地草稿永不冒充云端已同步
      </footer>
    </div>
  );
}
