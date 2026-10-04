import { nanoid } from "nanoid";
import type { Doc } from "../domain/types.js";
import type { ScriptRepository } from "../domain/repository.js";

/** 演示数据：开箱即有可编辑、可拆分的真实脚本。 */
export async function seedIfEmpty(repo: ScriptRepository): Promise<void> {
  const existing = await repo.listScripts();
  if (existing.length > 0) return;

  const id = "demo-script";
  const mk = <T extends { id: string }>(prefix: string, n: number, fn: (id: string, i: number) => T): T[] =>
    Array.from({ length: n }, (_, i) => fn(`${prefix}_${nanoid(6)}`, i));

  const characters = [
    { id: "char_narrator", name: "旁白", color: "#6366f1" },
    { id: "char_lin", name: "林溪（讲解员）", color: "#0ea5e9" },
    { id: "char_zhou", name: "周屿（游客）", color: "#f59e0b" },
  ];

  const scenes = [
    { id: "sc_01", index: 0, heading: "晨雾·入园", narration: "清晨六点，云溪公园在薄雾中苏醒。", status: "active" as const, origin: "seed" as const, parentSceneId: null, deleted: false, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "sc_02", index: 1, heading: "湖畔·相遇", narration: "木栈道沿湖伸展，游人渐次到来。", status: "active" as const, origin: "seed" as const, parentSceneId: null, deleted: false, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "sc_03", index: 2, heading: "山顶·俯瞰", narration: "登至观云台，整座城市尽收眼底。", status: "active" as const, origin: "seed" as const, parentSceneId: null, deleted: false, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
  ];

  const lines = [
    { id: "ln_01", sceneId: "sc_01", order: 0, characterId: "char_narrator", text: "这里是城市边缘的一片绿洲。", needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "ln_02", sceneId: "sc_01", order: 1, characterId: "char_lin", text: "大家好，我是林溪，跟我出发吧。", needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "ln_03", sceneId: "sc_02", order: 0, characterId: "char_zhou", text: "这湖水的颜色，像是整块翡翠。", needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "ln_04", sceneId: "sc_02", order: 1, characterId: "char_lin", text: "清晨的光打过来，最适合拍照。", needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "ln_05", sceneId: "sc_03", order: 0, characterId: "char_narrator", text: "三百二十级台阶之后，是另一种呼吸。", needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
  ];

  const shots = [
    { id: "sh_01", sceneId: "sc_01", order: 0, label: "航拍·雾海", description: "无人机由湖面推向山门", durationMs: 6000, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "sh_02", sceneId: "sc_01", order: 1, label: "近景·露珠", description: "草叶露珠微距", durationMs: 4000, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "sh_03", sceneId: "sc_02", order: 0, label: "跟拍·栈道", description: "稳定器跟随两人脚步", durationMs: 7000, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "sh_04", sceneId: "sc_02", order: 1, label: "特写·湖面", description: "波光与倒影", durationMs: 5000, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "sh_05", sceneId: "sc_03", order: 0, label: "大远景·云海", description: "观云台摇臂升起", durationMs: 8000, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
  ];

  const materials = [
    { id: "mt_01", sceneId: "sc_01", kind: "video" as const, name: "gate_fog_4k.mp4", startMs: 0, endMs: 6000, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "mt_02", sceneId: "sc_01", kind: "audio" as const, name: "morning_birds.wav", startMs: 0, endMs: 10000, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "mt_03", sceneId: "sc_02", kind: "video" as const, name: "lake_walk.mov", startMs: 0, endMs: 12000, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "mt_04", sceneId: "sc_03", kind: "image" as const, name: "summit_panorama.jpg", startMs: 0, endMs: 8000, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
  ];

  const anchors = [
    { id: "an_01", sceneId: "sc_01", refType: "line" as const, refId: "ln_01", timeMs: 1500, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "an_02", sceneId: "sc_02", refType: "shot" as const, refId: "sh_03", timeMs: 2000, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
    { id: "an_03", sceneId: "sc_03", refType: "line" as const, refId: "ln_05", timeMs: 3000, needsRepair: false, repairReason: null, createdInRev: 0, createdBy: "system", updatedInRev: 0, updatedBy: "" },
  ];

  const entities = {
    characters,
    scenes,
    lines,
    shots,
    materials,
    anchors,
    conflicts: [],
  } satisfies Omit<Doc, "id" | "title" | "headRev">;
  void mk;

  await repo.createScript({ id, title: "云溪公园宣传片 · 脚本 v3", entities });
}
