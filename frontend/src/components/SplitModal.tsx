import { useMemo, useState } from "react";
import { X, Scissors } from "lucide-react";
import type { DocDTO } from "@/api/types";
import { useEditor } from "@/store/editorStore";
import { fmtDuration } from "@/utils/format";

interface Props {
  sceneId: string;
  doc: DocDTO;
  onClose: () => void;
}

/**
 * 拆场对话框：切点按镜头累计时长选择；每条台词必须显式选择归属（上/下），
 * 未选的将在服务端进入待修复状态——绝不依赖数组下标。
 */
export default function SplitModal({ sceneId, doc, onClose }: Props) {
  const { enqueue } = useEditor();
  const scene = doc.scenes.find((s) => s.id === sceneId)!;
  const shots = useMemo(
    () => doc.shots.filter((s) => s.sceneId === sceneId).sort((a, b) => a.order - b.order),
    [doc, sceneId],
  );
  const lines = useMemo(
    () => doc.lines.filter((l) => l.sceneId === sceneId).sort((a, b) => a.order - b.order),
    [doc, sceneId],
  );

  const bounds = useMemo(() => {
    const out: number[] = [0];
    let acc = 0;
    shots.forEach((s) => {
      acc += s.durationMs;
      out.push(acc);
    });
    return [...new Set(out)];
  }, [shots]);

  const total = bounds[bounds.length - 1] ?? 0;
  const [cutIdx, setCutIdx] = useState(Math.max(1, bounds.length - 1));
  const cutMs = bounds[Math.min(cutIdx, bounds.length - 1)] ?? total;
  const [side, setSide] = useState<Record<string, "head" | "tail">>({});
  const [headHeading, setHeadHeading] = useState(`${scene.heading}（上）`);
  const [tailHeading, setTailHeading] = useState(`${scene.heading}（下）`);

  const unassigned = lines.filter((l) => !side[l.id]).length;

  const submit = () => {
    enqueue({
      type: "scene.split",
      label: `拆分《${scene.heading}》于 ${fmtDuration(cutMs)}`,
      payload: { sceneId, cutMs, headHeading, tailHeading, lineSide: side },
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card w-full max-w-2xl max-h-[85vh] overflow-y-auto scroll-thin">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Scissors size={17} className="text-indigo-600" />
          <h3 className="font-semibold">拆分场次：{scene.heading}</h3>
          <button className="btn-ghost ml-auto !p-1.5" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <div className="text-sm font-medium mb-2">切点位置（按镜头边界）</div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <input
                type="range"
                min={0}
                max={bounds.length - 1}
                value={Math.min(cutIdx, bounds.length - 1)}
                onChange={(e) => setCutIdx(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
              <div className="flex justify-between text-[11px] text-slate-400 font-mono mt-1">
                {bounds.map((b, i) => (
                  <button
                    key={i}
                    className={`hover:text-indigo-600 ${i === Math.min(cutIdx, bounds.length - 1) ? "text-indigo-600 font-semibold" : ""}`}
                    onClick={() => setCutIdx(i)}
                  >
                    {fmtDuration(b)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                切点 <span className="font-mono">{cutMs}ms</span>：跨越切点的镜头与素材区间将被标记为
                <span className="text-orange-600">待修复</span>，由你后续裁决，系统不会静默裁剪或丢弃。
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">
              上半场标题
              <input className="input mt-1" value={headHeading} onChange={(e) => setHeadHeading(e.target.value)} />
            </label>
            <label className="text-xs">
              下半场标题
              <input className="input mt-1" value={tailHeading} onChange={(e) => setTailHeading(e.target.value)} />
            </label>
          </div>

          <div>
            <div className="text-sm font-medium mb-2">
              台词归属
              {unassigned > 0 && <span className="ml-2 text-xs text-orange-600">还有 {unassigned} 条未选择，提交后进入待修复</span>}
            </div>
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                  <span className="text-xs text-slate-500 w-16 shrink-0">
                    {doc.characters.find((c) => c.id === l.characterId)?.name ?? "旁白"}
                  </span>
                  <span className="text-sm truncate flex-1">{l.text}</span>
                  <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                    {(["head", "tail"] as const).map((s) => (
                      <button
                        key={s}
                        className={`px-3 py-1 transition ${side[l.id] === s ? "bg-indigo-600 text-white" : "bg-white hover:bg-slate-50"}`}
                        onClick={() => setSide((p) => ({ ...p, [l.id]: s }))}
                      >
                        {s === "head" ? "上半" : "下半"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {lines.length === 0 && <p className="text-xs text-slate-400">该场暂无台词</p>}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              角色、字幕锚点与素材使用稳定身份引用：拆分会把它们带到新场次，而不是改写数组下标。
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={submit}><Scissors size={14} /> 提交拆分</button>
        </div>
      </div>
    </div>
  );
}
