import { PlayCircle, Clock3 } from "lucide-react";
import type { PreviewDTO } from "@/api/types";
import { fmtDuration } from "@/utils/format";
import { useEditor } from "@/store/editorStore";

/**
 * 预览卡与编辑页合计来自同一份 preview 数据（同一修订 rev），
 * 保证"脚本合计与预览卡引用同一修订"这一验收点。
 */
export default function PreviewCard({ preview }: { preview: PreviewDTO }) {
  const previewRev = useEditor((s) => s.previewRev);
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 bg-gradient-to-r from-indigo-600 to-sky-500 text-white flex items-center gap-3">
        <PlayCircle size={18} />
        <span className="text-sm font-semibold">预览卡（只读）</span>
        <span className="badge bg-white/20 text-white ml-auto">数据修订 rev {previewRev}</span>
      </div>
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-6 mb-4">
          <Metric label="脚本合计时长" value={fmtDuration(preview.summary.totalDurationMs)} accent />
          <Metric label="场次" value={String(preview.summary.sceneCount)} />
          <Metric label="待修复引用" value={String(preview.summary.pendingRepair)} warn={preview.summary.pendingRepair > 0} />
          <Metric label="未决冲突" value={String(preview.summary.openConflicts)} warn={preview.summary.openConflicts > 0} />
        </div>
        <div className="space-y-3">
          {preview.scenes.map((s) => {
            const dur = s.sceneDurationMs ?? s.shots.reduce((a, x) => a + (x.needsRepair ? 0 : x.durationMs), 0);
            return (
              <div key={s.id} className={`rounded-xl border p-3 ${s.status === "pending_orphan" ? "border-amber-300 bg-amber-50/60" : "border-slate-200"}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400">#{s.no}</span>
                  <span className="text-sm font-medium">{s.heading}</span>
                  {s.status === "pending_orphan" && <span className="badge bg-amber-100 text-amber-800">隔离待裁决</span>}
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-indigo-600 font-mono">
                    <Clock3 size={12} /> {fmtDuration(dur)}
                  </span>
                </div>
                {s.narration && <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">旁白：{s.narration}</p>}
                <div className="mt-2 space-y-1">
                  {s.lines.map((l) => (
                    <div key={l.id} className={`text-[11px] flex gap-2 ${l.needsRepair ? "text-orange-700" : "text-slate-600"}`}>
                      <span className="text-slate-400 shrink-0">{l.characterName ?? "??"}：</span>
                      <span className={l.needsRepair ? "underline decoration-orange-300 decoration-wavy" : ""}>{l.text || "（空台词）"}</span>
                      {l.needsRepair && <span className="text-orange-500">⚠ {l.repairReason}</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`text-xl font-semibold font-mono mt-0.5 ${warn ? "text-rose-600" : accent ? "text-indigo-600" : "text-slate-700"}`}>
        {value}
      </div>
    </div>
  );
}
