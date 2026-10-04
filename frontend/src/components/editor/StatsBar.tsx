import { useEditorStore } from "../../store/editorStore";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round((sec - m * 60) * 10) / 10;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

export default function StatsBar() {
  const { script, queue } = useEditorStore();
  if (!script) return null;

  // 合计直接取服务端快照字段：与右侧预览卡同一份 revision，绝不各算各的
  const stats = [
    { label: "脚本总时长", value: fmt(script.totalDurationSec), tone: "indigo", sub: `r${script.revision}` },
    { label: "场次", value: String(script.sceneCount), tone: "sky", sub: "稳定身份排序" },
    { label: "节点（旁白/台词/镜头）", value: String(script.elementCount), tone: "violet", sub: "含待归场" },
    {
      label: "待修复",
      value: String(script.pendingConflicts.length + script.orphanElements.length + script.reviewItems.anchors.length + script.reviewItems.ranges.length),
      tone: script.pendingConflicts.length ? "rose" : "emerald",
      sub: script.pendingConflicts.length ? `${script.pendingConflicts.length} 个冲突` : "无冲突",
    },
    { label: "本地待同步", value: String(queue.length), tone: queue.length ? "amber" : "slate", sub: queue.length ? "local-only" : "已清空" },
  ] as const;

  const tones: Record<string, string> = {
    indigo: "from-indigo-500/10 text-indigo-700 ring-indigo-100",
    sky: "from-sky-500/10 text-sky-700 ring-sky-100",
    violet: "from-violet-500/10 text-violet-700 ring-violet-100",
    rose: "from-rose-500/10 text-rose-700 ring-rose-100",
    emerald: "from-emerald-500/10 text-emerald-700 ring-emerald-100",
    amber: "from-amber-500/10 text-amber-700 ring-amber-100",
    slate: "from-slate-500/10 text-slate-600 ring-slate-100",
  };

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((st) => (
        <div
          key={st.label}
          className={`rounded-xl bg-gradient-to-br to-white p-3 ring-1 ${tones[st.tone]} transition-shadow hover:shadow-card`}
        >
          <p className="text-[11px] font-medium opacity-70">{st.label}</p>
          <p className="mt-1 text-xl font-bold tracking-tight">{st.value}</p>
          <p className="mt-0.5 text-[10px] opacity-60">{st.sub}</p>
        </div>
      ))}
    </div>
  );
}
