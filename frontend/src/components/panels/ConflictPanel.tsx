import { useEditorStore } from "../../store/editorStore";
import type { ConflictView } from "../../types/script";

export default function ConflictPanel() {
  const { script, resolveConflict, dispatch } = useEditorStore();
  if (!script) return null;

  const conflicts = script.pendingConflicts;
  const brokenAnchors = script.reviewItems.anchors;
  const reviewRanges = script.reviewItems.ranges;
  const orphans = script.orphanElements;
  const total = conflicts.length + brokenAnchors.length + reviewRanges.length + orphans.length;

  return (
    <div className="space-y-3">
      <div className={`rounded-xl border p-3 ${total ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
        <p className={`text-sm font-bold ${total ? "text-rose-700" : "text-emerald-700"}`}>
          {total ? `⚠️ ${total} 项待修复` : "✅ 引用完整，无待修复项"}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          所有冲突都保留原始操作和涉及的稳定身份，由你显式选择结果——系统不会无声丢弃任何内容。
        </p>
      </div>

      {conflicts.map((c) => <ConflictCard key={c.id} conflict={c} onResolve={(action) => resolveConflict(c.id, action)} />)}

      {orphans.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-white p-3">
          <p className="text-xs font-bold text-amber-700">🪑 待归场节点</p>
          {orphans.map((e) => (
            <div key={e.id} className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px]">
              <p className="font-mono text-amber-500">{e.id}</p>
              <p className="text-slate-600">{e.content || "(空)"}</p>
              {e.reviewReason && <p className="mt-0.5 text-amber-600">⚑ {e.reviewReason}</p>}
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="text-amber-700">重新归场：</span>
                <select
                  defaultValue=""
                  onChange={(ev) => {
                    const sceneId = ev.target.value;
                    if (!sceneId) return;
                    dispatch(
                      { type: "reattachElement", elementId: e.id, sceneId },
                      `节点 ${e.id} 归入「${script.scenes.find((x) => x.id === sceneId)?.title ?? sceneId}」`,
                    );
                    ev.target.value = "";
                  }}
                  className="rounded-md border border-amber-200 bg-white px-1.5 py-1 text-[11px]"
                >
                  <option value="" disabled>选择场次…</option>
                  {script.scenes.map((sc) => (
                    <option key={sc.id} value={sc.id}>{sc.title}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {brokenAnchors.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-white p-3">
          <p className="text-xs font-bold text-amber-700">🔖 字幕锚点待修复</p>
          {brokenAnchors.map((a) => (
            <div key={a.id} className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px]">
              <span className={`mr-1 rounded px-1 py-0.5 font-semibold ${a.status === "broken" ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-700"}`}>
                {a.code} · {a.status}
              </span>
              <span className="text-slate-600">{a.text}</span>
              {a.note && <p className="mt-0.5 text-amber-600">⚑ {a.note}</p>}
            </div>
          ))}
        </div>
      )}

      {reviewRanges.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-white p-3">
          <p className="text-xs font-bold text-amber-700">🎞️ 素材区间待确认</p>
          {reviewRanges.map((r) => (
            <div key={r.id} className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px]">
              <p className="font-semibold text-slate-700">{r.label}</p>
              <p className="font-mono text-slate-400">{r.startMs}ms → {r.endMs}ms（{r.assetId}）</p>
              {r.note && <p className="mt-0.5 text-amber-600">⚑ {r.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConflictCard({ conflict, onResolve }: { conflict: ConflictView; onResolve: (action: Record<string, unknown>) => void }) {
  const d = conflict.detail as {
    message?: string;
    field?: string;
    incoming?: unknown;
    existing?: unknown;
    base?: unknown;
    sceneIds?: string[];
    elementIds?: string[];
  };

  return (
    <div className="rounded-xl border border-rose-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
          {conflict.kind === "field" ? "字段冲突" : "结构冲突"}
        </span>
        <span className="text-[11px] text-slate-400">{conflict.author.name} 基于 r{conflict.baseSeq} 的操作</span>
        <span className="ml-auto font-mono text-[10px] text-slate-300">{conflict.opId.slice(0, 14)}</span>
      </div>

      {conflict.kind === "field" ? (
        <div className="mt-2 text-[11px]">
          <p className="font-semibold text-slate-700">同一字段「{d.field}」被两人修改</p>
          <div className="mt-1 grid grid-cols-3 gap-1.5 text-center">
            <Value title="我的新值" value={d.incoming} tone="indigo" />
            <Value title="当前云端值" value={d.existing} tone="rose" />
            <Value title="我编辑时的基线" value={d.base} tone="slate" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ResolveBtn onClick={() => onResolve({ action: "use_incoming" })}>采用我的值</ResolveBtn>
            <ResolveBtn onClick={() => onResolve({ action: "keep_existing" })} tone="slate">保留云端值</ResolveBtn>
            <CustomValue onSubmit={(v) => onResolve({ action: "custom", value: v })} />
          </div>
        </div>
      ) : (
        <div className="mt-2 text-[11px]">
          <p className="font-semibold text-slate-700">{d.message}</p>
          {(d.elementIds?.length ?? 0) > 0 && (
            <p className="mt-1 text-slate-400">涉及节点：{d.elementIds!.join(", ")}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {conflict.kind === "split_vs_delete" && (
              <>
                <ResolveBtn onClick={() => onResolve({ action: "use_incoming" })}>恢复原场并完成拆场</ResolveBtn>
                <ResolveBtn onClick={() => onResolve({ action: "adopt_orphans" })} tone="amber">
                  原场维持删除，节点抢救为待归场
                </ResolveBtn>
              </>
            )}
            {(conflict.kind === "merge_vs_delete" || conflict.kind === "delete_vs_edit" || conflict.kind === "missing_identity") && (
              <>
                <ResolveBtn onClick={() => onResolve({ action: "use_incoming" })}>在当前修订上重做我的操作</ResolveBtn>
                <ResolveBtn onClick={() => onResolve({ action: "adopt_orphans" })} tone="amber">抢救涉及节点为待归场</ResolveBtn>
              </>
            )}
            <ResolveBtn onClick={() => onResolve({ action: "keep_existing" })} tone="slate">
              放弃本次意图（保留操作存档）
            </ResolveBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function Value({ title, value, tone }: { title: string; value: unknown; tone: string }) {
  const cls = {
    indigo: "bg-indigo-50 text-indigo-700",
    rose: "bg-rose-50 text-rose-700",
    slate: "bg-slate-50 text-slate-500",
  }[tone]!;
  return (
    <div className={`rounded-lg p-1.5 ${cls}`}>
      <p className="text-[9px] opacity-70">{title}</p>
      <p className="mt-0.5 truncate font-semibold" title={String(value)}>{String(value ?? "∅")}</p>
    </div>
  );
}

function ResolveBtn({ children, onClick, tone = "indigo" }: { children: React.ReactNode; onClick: () => void; tone?: "indigo" | "slate" | "amber" }) {
  const cls = {
    indigo: "bg-indigo-500 text-white hover:bg-indigo-600",
    amber: "bg-amber-100 text-amber-700 hover:bg-amber-200",
    slate: "border border-slate-200 text-slate-500 hover:bg-slate-50",
  }[tone];
  return (
    <button onClick={onClick} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition active:scale-95 ${cls}`}>
      {children}
    </button>
  );
}

function CustomValue({ onSubmit }: { onSubmit: (v: string) => void }) {
  return (
    <input
      placeholder="手动输入合并值，回车"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
          onSubmit((e.target as HTMLInputElement).value.trim());
        }
      }}
      className="w-40 rounded-lg border border-slate-200 px-2 py-1 text-[11px] outline-none focus:border-indigo-300"
    />
  );
}
