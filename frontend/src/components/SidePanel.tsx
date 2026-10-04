import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  History,
  ShieldAlert,
  Wrench,
  TerminalSquare,
  Undo2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Zap,
} from "lucide-react";
import { useEditor } from "@/store/editorStore";
import type { Conflict, Revision } from "@/api/types";
import { fmtTime, OP_LABELS } from "@/utils/format";

type Tab = "revisions" | "conflicts" | "repair" | "log";

export default function SidePanel() {
  const [tab, setTab] = useState<Tab>("revisions");
  const tabs: Array<{ key: Tab; label: string; icon: JSX.Element; badge?: number }> = [
    { key: "revisions", label: "修订", icon: <History size={13} /> },
    { key: "conflicts", label: "冲突中心", icon: <ShieldAlert size={13} /> },
    { key: "repair", label: "待修复", icon: <Wrench size={13} /> },
    { key: "log", label: "协作日志", icon: <TerminalSquare size={13} /> },
  ];
  return (
    <div className="card flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-slate-100 px-2 pt-2 gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition ${
              tab === t.key ? "text-indigo-700 bg-indigo-50" : "text-slate-500 hover:bg-slate-50"
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.icon}
            {t.label}
            {t.key === "conflicts" && <OpenConflictBadge />}
            {t.key === "repair" && <RepairBadge />}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-3">
        {tab === "revisions" && <RevisionsTab />}
        {tab === "conflicts" && <ConflictsTab />}
        {tab === "repair" && <RepairTab />}
        {tab === "log" && <LogTab />}
      </div>
    </div>
  );
}

function OpenConflictBadge() {
  const n = useEditor((s) => s.doc?.conflicts.filter((c) => c.status === "open").length ?? 0);
  if (!n) return null;
  return <span className="badge bg-rose-100 text-rose-700 !px-1.5">{n}</span>;
}
function RepairBadge() {
  const n = useEditor((s) => s.doc?.summary.pendingRepair ?? 0);
  if (!n) return null;
  return <span className="badge bg-orange-100 text-orange-700 !px-1.5">{n}</span>;
}

function ResultPill({ r }: { r: Revision["result"] }) {
  if (r.status === "accepted")
    return (
      <span className="badge bg-emerald-50 text-emerald-700">
        <CheckCircle2 size={10} /> accepted{r.rebased ? " · 已变基" : ""}
      </span>
    );
  if (r.status === "blocked")
    return (
      <span className="badge bg-slate-100 text-slate-600" title={r.message}>
        <XCircle size={10} /> blocked{r.code ? ` · ${r.code}` : ""}
      </span>
    );
  return (
    <span className="badge bg-rose-50 text-rose-700">
      <ShieldAlert size={10} /> conflict
    </span>
  );
}

function RevisionsTab() {
  const { revisions, author, enqueue, queue } = useEditor();
  const undoableTypes = useMemo(() => new Set(["edit.field", "scene.split", "scene.merge", "scene.delete", "scene.move"]), []);

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-400 px-1">
        修订只追加、不可变，是操作与结果的证据链。撤销只反转<span className="text-indigo-600">本人</span>的可撤销意图；
        若他人随后改过同一字段或拆出的子场，撤销会被拒绝。
      </p>
      {[...revisions].reverse().map((r) => {
        const own = r.author === author;
        const canUndo = own && r.result.status === "accepted" && undoableTypes.has(r.type) && queue.length === 0;
        return (
          <div key={r.seq} className={`rounded-xl border p-2.5 ${own ? "border-indigo-100 bg-indigo-50/40" : "border-slate-200"}`}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-slate-500">#{r.seq}</span>
              <span className="text-xs font-medium">{OP_LABELS[r.type] ?? r.type}</span>
              <span className="text-[10px] text-slate-400">base {r.baseRev}</span>
              <span className="ml-auto"><ResultPill r={r.result} /></span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-500">
              <span className="badge bg-slate-100 text-slate-600">{r.author}</span>
              <span>{fmtTime(r.createdAt)}</span>
              {own && <span className="text-indigo-500">（我）</span>}
              <button
                className="btn-ghost !py-0.5 !px-2 !text-[11px] ml-auto disabled:opacity-30"
                disabled={!canUndo}
                title={!own ? "只能撤销自己的操作" : queue.length ? "有待发草稿，请先同步" : "撤销此修订"}
                onClick={() =>
                  enqueue({
                    type: "undo",
                    label: `撤销 #${r.seq}（${OP_LABELS[r.type]}）`,
                    payload: { revisionSeq: r.seq },
                  })
                }
              >
                <Undo2 size={11} /> 撤销
              </button>
            </div>
            {r.result.status === "blocked" && (
              <p className="text-[11px] text-slate-500 mt-1.5 px-1">⛔ {r.result.message}</p>
            )}
          </div>
        );
      })}
      {revisions.length === 0 && <p className="text-xs text-slate-400 text-center py-8">还没有修订记录</p>}
    </div>
  );
}

function ConflictsTab() {
  const { doc, enqueue } = useEditor();
  const conflicts = doc?.conflicts ?? [];
  const resolve = (c: Conflict, resolution: "keep_split" | "keep_delete") => {
    enqueue({
      type: "conflict.resolve",
      label: `裁决冲突：${resolution === "keep_split" ? "采用拆分" : "采用删除"}`,
      payload: { conflictId: c.id, resolution },
    });
    toast.success("裁决已加入队列");
  };

  if (conflicts.length === 0)
    return <Empty icon={<ShieldAlert size={22} />} text="暂无结构冲突" hint="当“甲拆场、乙删除原场”等竞态发生时，系统会在这里要求显式裁决，绝不无声丢内容。" />;

  return (
    <div className="space-y-3">
      {conflicts.map((c) => (
        <div key={c.id} className={`rounded-xl border p-3 ${c.status === "open" ? "border-rose-200 bg-rose-50/50" : "border-slate-200 bg-slate-50"}`}>
          <div className="flex items-center gap-2">
            <ShieldAlert size={14} className={c.status === "open" ? "text-rose-600" : "text-slate-400"} />
            <span className="text-xs font-semibold">
              {c.kind === "split_deleted_parent" ? "拆场 vs 删除原场（离线竞态）" : "删除含拆分子场"}
            </span>
            <span className="ml-auto badge bg-slate-100 text-slate-500">#{c.raisedInRev}</span>
          </div>
          <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">{String(c.detail.message ?? "检测到结构冲突")}</p>
          <div className="mt-2 text-[11px] text-slate-500">
            提出者：{c.raisedBy}
            {c.status === "resolved" && <> · 裁决者：{c.resolvedBy} · 结果：{c.resolution === "keep_split" ? "采用拆分" : "采用删除"}</>}
          </div>
          {c.status === "open" && (
            <div className="mt-3 flex gap-2">
              <button className="btn-primary !text-xs !py-1" onClick={() => resolve(c, "keep_split")}>
                <CheckCircle2 size={12} /> 采用拆分（保留子场内容）
              </button>
              <button className="btn-danger !text-xs !py-1" onClick={() => resolve(c, "keep_delete")}>
                <MinusCircle size={12} /> 采用删除（移除子场，证据保留）
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RepairTab() {
  const { doc, enqueue } = useEditor();
  if (!doc) return null;
  const groups: Array<{ kind: "line" | "shot" | "material" | "anchor"; id: string; reason: string | null; sceneId: string; label: string }> = [];
  for (const l of doc.lines.filter((x) => x.needsRepair))
    groups.push({ kind: "line", id: l.id, reason: l.repairReason, sceneId: l.sceneId, label: `台词：${l.text.slice(0, 24)}…` });
  for (const s of doc.shots.filter((x) => x.needsRepair))
    groups.push({ kind: "shot", id: s.id, reason: s.repairReason, sceneId: s.sceneId, label: `镜头：${s.label}` });
  for (const m of doc.materials.filter((x) => x.needsRepair))
    groups.push({ kind: "material", id: m.id, reason: m.repairReason, sceneId: m.sceneId, label: `素材：${m.name}` });
  for (const a of doc.anchors.filter((x) => x.needsRepair))
    groups.push({ kind: "anchor", id: a.id, reason: a.repairReason, sceneId: a.sceneId, label: `锚点 → ${a.refType}` });

  if (groups.length === 0)
    return <Empty icon={<Wrench size={22} />} text="没有待修复引用" hint="拆场中跨越切点的镜头/素材、未指定归属的台词会在这里列出，修复后引用完整性恢复。" />;

  const activeScenes = doc.scenes.filter((s) => !s.deleted).sort((a, b) => a.index - b.index);

  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={`${g.kind}-${g.id}`} className="rounded-xl border border-orange-200 bg-orange-50/50 p-2.5">
          <div className="text-xs font-medium">{g.label}</div>
          <div className="text-[11px] text-orange-700 mt-0.5">{g.reason}</div>
          <div className="mt-2 flex items-center gap-2">
            <select
              className="input !py-1 !text-xs flex-1"
              defaultValue={g.sceneId}
              onChange={(e) => {
                enqueue({
                  type: "repair.resolve",
                  label: `修复引用归属：${g.label}`,
                  payload: { refType: g.kind, refId: g.id, fields: { sceneId: e.target.value } },
                });
              }}
            >
              {activeScenes.map((s) => (
                <option key={s.id} value={s.id}>
                  归属：第 {s.index + 1} 场 · {s.heading}
                </option>
              ))}
            </select>
            <button
              className="btn-ghost !text-xs !py-1"
              onClick={() =>
                enqueue({ type: "repair.resolve", label: `确认无需修复：${g.label}`, payload: { refType: g.kind, refId: g.id, fields: {}, clear: true } })
              }
            >
              仅清除标记
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function LogTab() {
  const { logs, requestStalePreview, online } = useEditor();
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button
          className="btn-warn !text-xs"
          disabled={!online}
          title="发起一个慢请求，同时你可以继续操作；旧响应晚到时会被丢弃"
          onClick={() => void requestStalePreview(2500)}
        >
          <Zap size={12} /> 模拟：旧预览响应晚到（2.5s）
        </button>
      </div>
      <div className="space-y-1.5">
        {logs.map((l) => (
          <div
            key={l.id}
            className={`text-[11px] rounded-lg px-2 py-1.5 border ${
              l.kind === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : l.kind === "warn"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : l.kind === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-50 text-slate-600"
            }`}
          >
            <span className="font-mono text-slate-400 mr-1.5">{fmtTime(new Date(l.ts).toISOString())}</span>
            {l.text}
          </div>
        ))}
        {logs.length === 0 && <p className="text-xs text-slate-400 text-center py-8">操作后这里会出现协作事件</p>}
      </div>
    </div>
  );
}

function Empty({ icon, text, hint }: { icon: JSX.Element; text: string; hint: string }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="mx-auto w-11 h-11 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">{icon}</div>
      <div className="text-sm font-medium text-slate-600">{text}</div>
      <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{hint}</p>
    </div>
  );
}
