import { useEffect, useState } from "react";
import { scriptApi } from "../../api/scriptApi";
import { useEditorStore } from "../../store/editorStore";
import { getUserId } from "../../api/client";

interface UndoCheck {
  ok: boolean;
  reason?: string;
  blockers: { touch: string; by: string; detail: string }[];
}

export default function RevisionsPanel() {
  const { revisions, undo } = useEditorStore();
  const [checks, setChecks] = useState<Record<number, UndoCheck>>({});
  const userId = getUserId();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        revisions
          .filter((r) => r.undoable && r.author.id === userId && !r.undoneBy)
          .map(async (r) => {
            try {
              return [r.seq, await scriptApi.undoCheck("demo-script", r.seq)] as const;
            } catch {
              return null;
            }
          }),
      );
      if (!cancelled) {
        const map: Record<number, UndoCheck> = {};
        for (const e of entries) if (e) map[e[0]] = e[1];
        setChecks(map);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [revisions, userId]);

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-600">📜 修订证据链（仅追加）</p>
        每条修订记录作者、基版本、触碰身份与 rebase 轨迹。撤销只能反转<strong>本人</strong>的操作；
        若他人之后改过同一节点，撤销会被阻止，防止把别人的台词一并抹去。
      </div>
      {[...revisions].reverse().map((r) => {
        const mine = r.author.id === userId;
        const check = checks[r.seq];
        return (
          <div key={r.seq} className={`rounded-xl border bg-white p-3 shadow-sm ${r.undoneBy ? "border-slate-100 opacity-60" : "border-slate-200"}`}>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">r{r.seq}</span>
              <span className="text-[10px] font-semibold" style={{ color: ["#6366f1", "#f59e0b", "#10b981"][["u-jia", "u-yi", "u-bing"].indexOf(r.author.id)] }}>
                {r.author.name}
              </span>
              {r.rebasedFrom != null && (
                <span className="rounded bg-violet-50 px-1 py-0.5 text-[9px] font-medium text-violet-600">
                  rebase r{r.rebasedFrom}→[{r.rebasedOnto.join(",")}]
                </span>
              )}
              {r.undoneBy && <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-400">已撤销</span>}
            </div>
            <p className="mt-1 text-[11px] text-slate-600">{r.summary}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="font-mono text-[9px] text-slate-300">base r{r.baseSeq}</span>
              {r.undoable && mine && !r.undoneBy && (
                check?.ok === false ? (
                  <span className="ml-auto rounded bg-rose-50 px-2 py-0.5 text-[10px] text-rose-500" title={check.blockers.map((b) => b.detail).join("\n")}>
                    🔒 不可撤销{check.blockers.length ? `：${check.blockers[0].by}已改` : ""}
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      const msg = check?.blockers.length
                        ? `注意：${check.blockers.map((b) => b.detail).join("；")}。仍要撤销吗？`
                        : `撤销 #${r.seq}？`;
                      if (confirm(msg)) undo(r.seq);
                    }}
                    className="ml-auto rounded-lg border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600 active:scale-95"
                    title={check?.blockers.map((b) => b.detail).join("\n")}
                  >
                    ↩︎ 撤销我的这一步
                  </button>
                )
              )}
              {!mine && !r.undoneBy && (
                <span className="ml-auto text-[10px] text-slate-300">他人操作，不可撤销</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
