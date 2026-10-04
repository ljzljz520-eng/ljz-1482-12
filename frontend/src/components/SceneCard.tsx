import { useState } from "react";
import toast from "react-hot-toast";
import {
  Scissors,
  GitMerge,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Undo2,
  AlertTriangle,
  Clock3,
  MessageSquareText,
  Film,
  Paperclip,
  Anchor as AnchorIcon,
} from "lucide-react";
import type { DocDTO, PreviewScene } from "@/api/types";
import { useEditor } from "@/store/editorStore";
import { fmtDuration } from "@/utils/format";

interface Props {
  scene: PreviewScene;
  doc: DocDTO;
  allScenes: PreviewScene[];
  onSplit: (sceneId: string) => void;
  onMerge: (sceneId: string) => void;
}

export default function SceneCard({ scene, doc, allScenes, onSplit, onMerge }: Props) {
  const { enqueue, author } = useEditor();
  const [editing, setEditing] = useState<Record<string, string>>({});

  const activeScenes = allScenes;
  const pos = activeScenes.findIndex((s) => s.id === scene.id);

  const edit = (
    entityKind: "scene" | "line" | "shot",
    entityId: string,
    fields: Record<string, unknown>,
    label: string,
  ) => {
    enqueue({ type: "edit.field", payload: { entityKind, entityId, fields }, label });
  };

  const commitText = (
    entityKind: "scene" | "line" | "shot",
    entityId: string,
    field: string,
    original: string,
    label: string,
  ) => {
    const val = editing[`${entityKind}.${entityId}.${field}`];
    if (val === undefined || val === original) return;
    edit(entityKind, entityId, { [field]: val }, label);
    toast.success("已加入提交队列");
  };

  const charName = (id: string | null) => doc.characters.find((c) => c.id === id)?.name ?? "未指定角色";

  const statusBadge = () => {
    if (scene.status === "pending_orphan")
      return <span className="badge bg-amber-100 text-amber-800"><AlertTriangle size={11} /> 隔离待裁决</span>;
    const repairs =
      scene.lines.filter((l) => l.needsRepair).length +
      scene.shots.filter((s) => s.needsRepair).length +
      scene.materials.filter((m) => m.needsRepair).length +
      scene.anchors.filter((a) => a.needsRepair).length;
    if (repairs > 0)
      return <span className="badge bg-orange-100 text-orange-700"><AlertTriangle size={11} /> {repairs} 处待修复</span>;
    return <span className="badge bg-emerald-50 text-emerald-700">引用完整</span>;
  };

  return (
    <section className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-3 bg-gradient-to-r from-white to-indigo-50/40">
        <span className="w-7 h-7 shrink-0 rounded-lg bg-indigo-600 text-white text-xs font-semibold flex items-center justify-center">
          {scene.no}
        </span>
        <input
          className="font-semibold text-slate-800 bg-transparent hover:bg-white focus:bg-white rounded px-1.5 py-0.5 outline-none border border-transparent focus:border-indigo-200 min-w-0 flex-1"
          defaultValue={scene.heading}
          key={`${scene.id}.heading`}
          onChange={(e) => (editing[`scene.${scene.id}.heading`] = e.target.value)}
          onBlur={(e) => commitText("scene", scene.id, "heading", scene.heading, `修改场次标题：${scene.heading}`)}
        />
        {statusBadge()}
      </div>

      <div className="p-5 grid gap-5 lg:grid-cols-2">
        {/* 旁白 */}
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-2">
            <MessageSquareText size={13} /> 旁白
          </div>
          <textarea
            className="input min-h-[72px] resize-y leading-relaxed"
            defaultValue={scene.narration}
            key={`${scene.id}.narration`}
            placeholder="输入旁白文本…"
            onChange={(e) => (editing[`scene.${scene.id}.narration`] = e.target.value)}
            onBlur={(e) => commitText("scene", scene.id, "narration", scene.narration, `修改《${scene.heading}》旁白`)}
          />

          {/* 台词 */}
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mt-4 mb-2">
            <Film size={13} /> 台词（角色身份为稳定 ID，拆场时跟随迁移）
          </div>
          <div className="space-y-2">
            {scene.lines.map((line) => (
              <div
                key={line.id}
                className={`rounded-xl border p-2.5 ${line.needsRepair ? "border-orange-200 bg-orange-50/60" : "border-slate-200 bg-slate-50/60"}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <select
                    className="text-xs rounded-md border border-slate-200 bg-white px-1.5 py-1 outline-none"
                    defaultValue={line.characterId ?? ""}
                    onChange={(e) =>
                      edit("line", line.id, { characterId: e.target.value || null }, `调整台词角色：${charName(line.characterId)}`)
                    }
                  >
                    <option value="">未指定角色</option>
                    {doc.characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-slate-400 font-mono">{line.id}</span>
                  {line.needsRepair && (
                    <span className="badge bg-orange-100 text-orange-700 ml-auto">
                      <AlertTriangle size={10} /> {line.repairReason ?? "待修复"}
                    </span>
                  )}
                </div>
                <textarea
                  className="w-full text-sm bg-white/80 rounded-lg border border-transparent hover:border-slate-200 focus:border-indigo-200 px-2 py-1 outline-none resize-none"
                  rows={2}
                  defaultValue={line.text}
                  key={line.id}
                  onChange={(e) => (editing[`line.${line.id}.text`] = e.target.value)}
                  onBlur={(e) => commitText("line", line.id, "text", line.text, `修改台词（${charName(line.characterId)}）`)}
                />
              </div>
            ))}
            {scene.lines.length === 0 && <p className="text-xs text-slate-400">暂无台词</p>}
          </div>
        </div>

        {/* 镜头与时长 */}
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-2">
            <Clock3 size={13} /> 镜头与时长（场次合计 = 镜头时长之和）
          </div>
          <div className="space-y-2">
            {scene.shots.map((shot) => (
              <div
                key={shot.id}
                className={`rounded-xl border p-2.5 ${shot.needsRepair ? "border-orange-200 bg-orange-50/60" : "border-slate-200 bg-slate-50/60"}`}
              >
                <div className="flex items-center gap-2">
                  <input
                    className="text-sm font-medium bg-transparent outline-none flex-1 min-w-0 rounded px-1 py-0.5 hover:bg-white border border-transparent focus:border-indigo-200"
                    defaultValue={shot.label}
                    key={shot.id}
                    onChange={(e) => (editing[`shot.${shot.id}.label`] = e.target.value)}
                    onBlur={(e) => commitText("shot", shot.id, "label", shot.label, `修改镜头名：${shot.label}`)}
                  />
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <input
                      type="number"
                      min={0}
                      step={500}
                      className="input !w-24 !py-0.5 text-right font-mono"
                      defaultValue={shot.durationMs}
                      key={shot.id}
                      onChange={(e) => (editing[`shot.${shot.id}.durationMs`] = String(Number(e.target.value)))}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= 0 && v !== shot.durationMs)
                          edit("shot", shot.id, { durationMs: v }, `调整镜头《${shot.label}》时长`);
                      }}
                    />
                    ms
                  </div>
                  {shot.needsRepair && (
                    <span className="badge bg-orange-100 text-orange-700">
                      <AlertTriangle size={10} /> 跨切点
                    </span>
                  )}
                </div>
                <input
                  className="mt-1 w-full text-xs text-slate-500 bg-transparent outline-none rounded px-1 py-0.5 hover:bg-white border border-transparent focus:border-indigo-200"
                  defaultValue={shot.description}
                  key={shot.id}
                  placeholder="镜头描述"
                  onChange={(e) => (editing[`shot.${shot.id}.description`] = e.target.value)}
                  onBlur={(e) => commitText("shot", shot.id, "description", shot.description, `修改镜头《${shot.label}》描述`)}
                />
              </div>
            ))}
            {scene.shots.length === 0 && <p className="text-xs text-slate-400">暂无镜头</p>}
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl bg-indigo-50/70 px-3 py-2">
            <span className="text-xs text-indigo-700">场次合计</span>
            <span className="font-mono text-sm font-semibold text-indigo-700">
              {fmtDuration(scene.shots.reduce((a, s) => a + (s.needsRepair ? 0 : s.durationMs), 0))}
            </span>
          </div>

          {/* 素材与锚点（只读展示引用完整性） */}
          <div className="mt-4 space-y-2">
            {scene.materials.map((m) => (
              <div key={m.id} className={`flex items-center gap-2 text-xs rounded-lg border px-2.5 py-1.5 ${m.needsRepair ? "border-orange-200 bg-orange-50" : "border-slate-200"}`}>
                <Paperclip size={12} className="text-slate-400" />
                <span className="truncate">{m.name}</span>
                <span className="font-mono text-slate-400">{m.startMs}–{m.endMs}ms</span>
                {m.needsRepair && <span className="badge bg-orange-100 text-orange-700 ml-auto"><AlertTriangle size={10} /> 跨切点</span>}
              </div>
            ))}
            {scene.anchors.map((a) => (
              <div key={a.id} className={`flex items-center gap-2 text-xs rounded-lg border px-2.5 py-1.5 ${a.needsRepair ? "border-orange-200 bg-orange-50" : "border-slate-200"}`}>
                <AnchorIcon size={12} className="text-slate-400" />
                <span>字幕锚点 → {a.refType} <span className="font-mono text-slate-400">{a.refId.slice(0, 10)}…</span></span>
                <span className="font-mono text-slate-400">@{a.timeMs}ms</span>
                {a.needsRepair && <span className="badge bg-orange-100 text-orange-700 ml-auto">待修复</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-2">
        <button className="btn-ghost !text-xs" disabled={pos <= 0} onClick={() => enqueue({ type: "scene.move", payload: { sceneId: scene.id, toIndex: pos - 1 }, label: `前移《${scene.heading}》` })}>
          <ArrowLeft size={13} /> 前移
        </button>
        <button className="btn-ghost !text-xs" disabled={pos >= activeScenes.length - 1} onClick={() => enqueue({ type: "scene.move", payload: { sceneId: scene.id, toIndex: pos + 1 }, label: `后移《${scene.heading}》` })}>
          后移 <ArrowRight size={13} />
        </button>
        <div className="h-4 w-px bg-slate-200 mx-1" />
        <button className="btn-warn !text-xs" onClick={() => onSplit(scene.id)}>
          <Scissors size={13} /> 拆场
        </button>
        <button className="btn-ghost !text-xs" disabled={activeScenes.length < 2} onClick={() => onMerge(scene.id)}>
          <GitMerge size={13} /> 与相邻场合并
        </button>
        <button className="btn-danger !text-xs ml-auto" onClick={() => {
          if (confirm(`确认请求删除《${scene.heading}》？\n若该场已被拆分，将进入显式冲突裁决而非直接删除。`))
            enqueue({ type: "scene.delete", payload: { sceneId: scene.id }, label: `删除《${scene.heading}》` });
        }}>
          <Trash2 size={13} /> 删除
        </button>
        <span className="text-[10px] text-slate-400 w-full">当前身份：{author} · 所有操作先进入本地队列，服务器确认后才标记已同步</span>
      </div>
    </section>
  );
}
