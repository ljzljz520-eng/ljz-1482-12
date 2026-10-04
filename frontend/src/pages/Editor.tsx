import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useEditor, startPolling } from "@/store/editorStore";
import TopBar from "@/components/TopBar";
import SceneCard from "@/components/SceneCard";
import SplitModal from "@/components/SplitModal";
import MergeModal from "@/components/MergeModal";
import SidePanel from "@/components/SidePanel";
import PreviewCard from "@/components/PreviewCard";
import { AlertTriangle, Loader2 } from "lucide-react";

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const { load, doc, preview, loading, sync, queue, online } = useEditor();
  const [splitId, setSplitId] = useState<string | null>(null);
  const [mergeId, setMergeId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void load(id);
    const stop = startPolling(id, 2500);
    const onOnline = () => useEditor.getState().setOnline(true);
    const onOffline = () => useEditor.getState().setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      stop();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !doc || !preview) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 className="animate-spin" size={18} /> 正在载入脚本与修订…
        </div>
      </div>
    );
  }

  const previewScenes = preview.scenes;
  const failed = queue.filter((q) => q.status === "failed");

  return (
    <div className="min-h-screen">
      <TopBar />

      {(sync === "offline-draft" || !online) && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-2 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle size={13} />
          离线模式：你的操作只保存在浏览器本地草稿，<b>不会被标记为云端已同步</b>。恢复联网后将按顺序自动提交；
          若与他人的删除冲突，服务端会给出显式冲突结果。
        </div>
      )}
      {failed.length > 0 && (
        <div className="bg-rose-50 border-b border-rose-200 px-5 py-2 text-xs text-rose-800 flex items-center gap-2">
          <AlertTriangle size={13} />
          {failed.length} 条操作保存失败，草稿仍可见，可在顶栏重试。错误：{failed[0].error}
        </div>
      )}

      <main className="max-w-[1500px] mx-auto px-5 py-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5 min-w-0">
          <PreviewCard preview={preview} />
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">场次编辑（旁白 / 台词 / 镜头 / 时长）</h2>
            <span className="text-[11px] text-slate-400">引用全部基于稳定身份，节点迁移不依赖下标</span>
          </div>
          {previewScenes.map((s) => (
            <SceneCard key={s.id} scene={s} doc={doc} allScenes={previewScenes} onSplit={setSplitId} onMerge={setMergeId} />
          ))}
        </div>
        <aside className="xl:h-[calc(100vh-92px)] xl:sticky xl:top-[76px] min-h-[500px]">
          <SidePanel />
        </aside>
      </main>

      {splitId && <SplitModal sceneId={splitId} doc={doc} onClose={() => setSplitId(null)} />}
      {mergeId && <MergeModal sceneId={mergeId} doc={doc} onClose={() => setMergeId(null)} />}
    </div>
  );
}
