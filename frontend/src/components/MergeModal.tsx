import { useState } from "react";
import { X, GitMerge } from "lucide-react";
import type { DocDTO } from "@/api/types";
import { useEditor } from "@/store/editorStore";

interface Props {
  sceneId: string;
  doc: DocDTO;
  onClose: () => void;
}

export default function MergeModal({ sceneId, doc, onClose }: Props) {
  const { enqueue } = useEditor();
  const active = doc.scenes.filter((s) => !s.deleted).sort((a, b) => a.index - b.index);
  const idx = active.findIndex((s) => s.id === sceneId);
  const neighbors = [active[idx - 1], active[idx + 1]].filter(Boolean) as typeof active;
  const [target, setTarget] = useState(neighbors[0]?.id ?? "");
  const [heading, setHeading] = useState("");

  const submit = () => {
    const pair = [sceneId, target].sort(
      (a, b) => active.findIndex((s) => s.id === a) - active.findIndex((s) => s.id === b),
    );
    const first = active.find((s) => s.id === pair[0])!;
    const last = active.find((s) => s.id === pair[1])!;
    enqueue({
      type: "scene.merge",
      label: `合并《${first.heading}》＋《${last.heading}》`,
      payload: { sceneIds: pair, heading: heading || undefined },
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card w-full max-w-md">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <GitMerge size={17} className="text-indigo-600" />
          <h3 className="font-semibold">合并相邻场次</h3>
          <button className="btn-ghost ml-auto !p-1.5" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-sm">
            将《<b>{active[idx]?.heading}</b>》与哪个相邻场合并？
          </div>
          <div className="space-y-2">
            {neighbors.map((n) => (
              <label key={n.id} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer ${target === n.id ? "border-indigo-400 bg-indigo-50/60" : "border-slate-200"}`}>
                <input type="radio" name="merge-target" checked={target === n.id} onChange={() => setTarget(n.id)} />
                <span className="text-sm">{n.heading}</span>
                <span className="badge bg-slate-100 text-slate-500 ml-auto">第 {n.index + 1} 场</span>
              </label>
            ))}
          </div>
          <label className="text-xs block">
            合并后标题（留空自动生成）
            <input className="input mt-1" value={heading} onChange={(e) => setHeading(e.target.value)} />
          </label>
          <p className="text-[11px] text-slate-400">
            合并仅允许时间线上相邻的场次；引用内容通过稳定身份迁移到合并场，拆场导致的待修复标记会自动愈合。
          </p>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-primary" disabled={!target} onClick={submit}><GitMerge size={14} /> 提交合并</button>
        </div>
      </div>
    </div>
  );
}
