export function fmtDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d
    .getSeconds()
    .toString()
    .padStart(2, "0")}`;
}

export const OP_LABELS: Record<string, string> = {
  "edit.field": "编辑字段",
  "scene.split": "拆分场次",
  "scene.merge": "合并场次",
  "scene.delete": "删除场次",
  "scene.move": "移动场次",
  "repair.resolve": "修复引用",
  "conflict.resolve": "裁决冲突",
  undo: "撤销",
};
