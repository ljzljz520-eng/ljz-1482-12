import { useState } from "react";
import { useEditorStore, patchElement } from "../../store/editorStore";
import type { ElementView } from "../../types/script";
import { getUserId } from "../../api/client";

const KIND_META: Record<ElementView["kind"], { label: string; icon: string; cls: string }> = {
  narration: { label: "旁白", icon: "🎙️", cls: "bg-indigo-50 text-indigo-600 ring-indigo-100" },
  dialogue: { label: "台词", icon: "💬", cls: "bg-emerald-50 text-emerald-600 ring-emerald-100" },
  shot: { label: "镜头", icon: "🎥", cls: "bg-sky-50 text-sky-600 ring-sky-100" },
};

interface Props {
  element: ElementView;
  sceneId: string;
  checked: boolean;
  onToggleCheck: (id: string) => void;
}

export default function ElementRow({ element, sceneId, checked, onToggleCheck }: Props) {
  const { script, dispatch, select, selectedElementId, saveVisibleDraft } = useEditorStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(element.content);
  const meta = KIND_META[element.kind];

  if (!script) return null;
  const role = script.characters.find((c) => c.id === element.roleId);
  const selected = selectedElementId === element.id;

  const commitText = async () => {
    setEditing(false);
    if (draft === element.content) return;
    // 失败也保留可见草稿：明确 local-only，不冒充已同步
    saveVisibleDraft(element.id, sceneId, draft);
    await dispatch(
      {
        type: "editElement",
        elementId: element.id,
        fields: { content: draft },
        expected: { content: element.content },
      },
      `编辑${meta.label}内容`,
      (s) => patchElement(s, element.id, { content: draft }),
    );
  };

  const commitDuration = async (value: number) => {
    if (value === element.durationSec || Number.isNaN(value) || value < 0) return;
    await dispatch(
      { type: "setDuration", elementId: element.id, durationSec: value, expectedDurationSec: element.durationSec },
      `调整时长 ${value}s`,
      (s) => patchElement(s, element.id, { durationSec: value }),
    );
  };

  return (
    <div
      onClick={() => select(sceneId, element.id)}
      className={`group rounded-xl border bg-white p-3 transition-all hover:shadow-card ${
        selected ? "border-indigo-300 ring-2 ring-indigo-100" : "border-slate-200"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            e.stopPropagation();
            onToggleCheck(element.id);
          }}
          className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-500 focus:ring-indigo-400"
          title="选为拆场后迁到新场"
        />
        <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${meta.cls}`}>
          {meta.icon} {meta.label}
        </span>
        {element.kind === "dialogue" && (
          <select
            value={element.roleId ?? ""}
            onClick={(e) => e.stopPropagation()}
            onChange={async (e) => {
              const roleId = e.target.value || null;
              await dispatch(
                { type: "editElement", elementId: element.id, fields: { roleId }, expected: { roleId: element.roleId } },
                "修改台词角色",
                (s) => patchElement(s, element.id, { roleId }),
              );
            }}
            className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600"
          >
            {script.characters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {element.needsReview && (
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title={element.reviewReason ?? ""}>
            待修复
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-slate-300">#{element.id.slice(0, 10)}</span>
      </div>

      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitText();
            if (e.key === "Escape") {
              setDraft(element.content);
              setEditing(false);
            }
          }}
          className="mt-2 w-full resize-none rounded-lg border border-indigo-200 bg-indigo-50/30 p-2 text-sm leading-relaxed text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100"
          rows={2}
        />
      ) : (
        <p
          onClick={(e) => {
            e.stopPropagation();
            setDraft(element.content);
            setEditing(true);
          }}
          className="mt-1.5 cursor-text rounded-lg px-1 py-0.5 text-sm leading-relaxed text-slate-700 hover:bg-slate-50"
        >
          {element.content || <span className="text-slate-300">点击编辑…</span>}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 pl-6">
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          时长
          <input
            type="number"
            step="0.1"
            min="0"
            defaultValue={element.durationSec}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => commitDuration(Number(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-16 rounded-md border border-slate-200 px-1.5 py-0.5 text-right text-[11px] text-slate-700 focus:border-indigo-300 focus:outline-none"
          />
          秒
        </label>
        {role && <span className="text-[11px] text-slate-400">· {role.name}</span>}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`删除该${meta.label}？相关字幕锚点会进入待修复，不会被级联删除。`)) {
              dispatch(
                { type: "deleteElement", elementId: element.id },
                `删除${meta.label}`,
              );
            }
          }}
          className="ml-auto rounded-md px-2 py-0.5 text-[11px] text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
        >
          删除
        </button>
      </div>
      {element.reviewReason && (
        <p className="mt-1.5 pl-6 text-[10px] text-amber-600">⚑ {element.reviewReason}</p>
      )}
    </div>
  );
}
