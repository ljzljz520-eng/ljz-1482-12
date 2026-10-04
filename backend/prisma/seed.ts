/**
 * 初始化演示数据：云溪公园宣传片脚本（3 角色 / 4 场次 / 旁白台词镜头 / 字幕锚点 / 素材区间）。
 * 幂等：已存在则跳过。
 */
import { PrismaClient } from "@prisma/client";
import { logger } from "../src/lib/logger.js";

const prisma = new PrismaClient();

const SCRIPT_ID = "demo-script";

async function main() {
  const existing = await prisma.script.findUnique({ where: { id: SCRIPT_ID } });
  if (existing) {
    logger.info("演示数据已存在，跳过 seed");
    return;
  }

  await prisma.script.create({
    data: {
      id: SCRIPT_ID,
      title: "云溪公园 · 秋日宣传片脚本",
      description: "用于多人协同拆场的演示脚本：旁白、台词、镜头、字幕锚点与素材区间均带稳定身份。",
      headSeq: 1,
    },
  });

  const chars = [
    { id: "char-narrator", name: "旁白", color: "#6366f1" },
    { id: "char-guide", name: "讲解员林溪", color: "#f59e0b" },
    { id: "char-visitor", name: "游客阿明", color: "#10b981" },
  ];
  for (let i = 0; i < chars.length; i++) {
    await prisma.character.create({
      data: { scriptId: SCRIPT_ID, orderIdx: (i + 1) * 1024, ...chars[i] },
    });
  }

  const scenes = [
    { id: "scene-01", title: "开场 · 晨雾入园", orderIdx: 1024 },
    { id: "scene-02", title: "湖畔 · 飞鸟与栈道", orderIdx: 2048 },
    { id: "scene-03", title: "人文 · 讲解与互动", orderIdx: 3072 },
    { id: "scene-04", title: "尾声 · 落日全景", orderIdx: 4096 },
  ];
  for (const sc of scenes) {
    await prisma.sceneNode.create({ data: { scriptId: SCRIPT_ID, ...sc } });
  }

  type E = {
    id: string; sceneId: string; kind: "narration" | "dialogue" | "shot";
    roleId: string | null; content: string; durationSec: number; orderIdx: number;
  };
  const elements: E[] = [
    { id: "el-0101", sceneId: "scene-01", kind: "shot", roleId: null, content: "航拍：晨雾笼罩山谷，镜头推向公园大门", durationSec: 6.5, orderIdx: 1024 },
    { id: "el-0102", sceneId: "scene-01", kind: "narration", roleId: "char-narrator", content: "清晨五点半，云溪公园在薄雾中苏醒。", durationSec: 5.0, orderIdx: 2048 },
    { id: "el-0103", sceneId: "scene-01", kind: "dialogue", roleId: "char-guide", content: "欢迎来到云溪，今天由我带大家走一条最舒服的路线。", durationSec: 4.5, orderIdx: 3072 },
    { id: "el-0201", sceneId: "scene-02", kind: "shot", roleId: null, content: "低角度跟拍：水鸟掠过湖面，栈道延伸至芦苇深处", durationSec: 7.0, orderIdx: 1024 },
    { id: "el-0202", sceneId: "scene-02", kind: "narration", roleId: "char-narrator", content: "云溪湖栖息着六十多种鸟类，是城市边缘的生态客厅。", durationSec: 5.5, orderIdx: 2048 },
    { id: "el-0203", sceneId: "scene-02", kind: "dialogue", roleId: "char-visitor", content: "这栈道走起来一点都不累，风特别舒服。", durationSec: 3.5, orderIdx: 3072 },
    { id: "el-0301", sceneId: "scene-03", kind: "shot", roleId: null, content: "中景：讲解员在古榕下为孩子们演示叶脉标本", durationSec: 6.0, orderIdx: 1024 },
    { id: "el-0302", sceneId: "scene-03", kind: "dialogue", roleId: "char-guide", content: "摸一摸叶脉，就像摸到这座山的年轮。", durationSec: 4.0, orderIdx: 2048 },
    { id: "el-0303", sceneId: "scene-03", kind: "narration", roleId: "char-narrator", content: "自然教育课堂每周开放，让知识从纸面走进林间。", durationSec: 5.0, orderIdx: 3072 },
    { id: "el-0401", sceneId: "scene-04", kind: "shot", roleId: null, content: "大全景：夕阳把湖面染成金红色，人群剪影远去", durationSec: 8.0, orderIdx: 1024 },
    { id: "el-0402", sceneId: "scene-04", kind: "narration", roleId: "char-narrator", content: "一天结束，云溪把喧嚣留在了山外。", durationSec: 4.5, orderIdx: 2048 },
  ];
  for (const e of elements) {
    await prisma.element.create({ data: { scriptId: SCRIPT_ID, originSceneId: e.sceneId, ...e } });
  }

  const anchors = [
    { id: "anc-01", elementId: "el-0102", targetElementId: "el-0102", code: "S01", text: "清晨五点半，云溪公园在薄雾中苏醒。", timeMs: 6500 },
    { id: "anc-02", elementId: "el-0202", targetElementId: "el-0202", code: "S02", text: "六十多种鸟类，城市边缘的生态客厅。", timeMs: 19000 },
    { id: "anc-03", elementId: "el-0302", targetElementId: "el-0302", code: "S03", text: "叶脉就像这座山的年轮。", timeMs: 31000 },
    { id: "anc-04", elementId: "el-0402", targetElementId: "el-0402", code: "S04", text: "云溪把喧嚣留在了山外。", timeMs: 52000 },
  ];
  for (const a of anchors) {
    await prisma.subtitleAnchor.create({ data: { scriptId: SCRIPT_ID, status: "ok", ...a } });
  }

  const ranges = [
    { id: "rng-01", elementId: "el-0101", assetId: "asset-drone-a", label: "大门航拍素材", startMs: 0, endMs: 6500, status: "ok" as const },
    { id: "rng-02", elementId: "el-0201", assetId: "asset-lake-b", label: "湖面水鸟素材", startMs: 16000, endMs: 23000, status: "ok" as const },
    { id: "rng-03", elementId: "el-0301", assetId: "asset-banyan-c", label: "古榕课堂素材", startMs: 27000, endMs: 33000, status: "ok" as const },
    { id: "rng-04", elementId: "el-0401", assetId: "asset-sunset-d", label: "落日全景素材", startMs: 45000, endMs: 53000, status: "ok" as const },
  ];
  for (const r of ranges) {
    await prisma.mediaRange.create({ data: { scriptId: SCRIPT_ID, ...r } });
  }

  await prisma.revision.create({
    data: {
      scriptId: SCRIPT_ID,
      seq: 1,
      opId: "seed-init",
      kind: "restoreState",
      authorId: "u-jia",
      authorName: "甲",
      summary: "初始化脚本",
      baseSeq: 0,
      payload: { seed: true },
      touched: [],
      fingerprints: {},
      rebasedOnto: [],
      undoable: false,
    },
  });

  logger.info("✅ 演示数据填充完成：demo-script（4 场次 / 11 元素 / 4 锚点 / 4 素材区间）");
}

main()
  .catch((e) => {
    logger.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
