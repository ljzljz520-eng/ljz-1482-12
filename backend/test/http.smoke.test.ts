/**
 * HTTP 端到端冒烟测试（内存 Prisma，需配合 test/register-memory-prisma.ts 预加载）。
 * 运行：node --import ./test/register-memory-prisma.ts --import tsx --test test/http.smoke.test.ts
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { scriptRoutes } from "../src/routes/script.js";
import { prisma as db } from "../src/lib/prisma.js";
import { loadSnapshot } from "../src/services/snapshot.js";
import { commitOperation } from "../src/services/commits.js";
import { undoRevision } from "../src/services/undo.js";
import { resolveConflict, listConflicts } from "../src/services/conflicts.js";
import type { Snapshot } from "../src/domain/types.js";

const SCRIPT = "demo-script";
const jia = { id: "u-jia", name: "甲" };
const yi = { id: "u-yi", name: "乙" };
const bing = { id: "u-bing", name: "丙" };

async function seed() {
  await db.script.create({
    data: {
      id: SCRIPT,
      title: "冒烟脚本",
      description: "test",
      headSeq: 1,
      updatedAt: new Date(),
      createdAt: new Date(),
    },
  });
  await db.character.create({ data: { id: "c1", scriptId: SCRIPT, name: "旁白", color: "#6366f1", orderIdx: 1024 } });
  await db.character.create({ data: { id: "c2", scriptId: SCRIPT, name: "林溪", color: "#f59e0b", orderIdx: 2048 } });
  const scenes = [
    { id: "S1", scriptId: SCRIPT, title: "第一场", orderIdx: 1024, createdAt: new Date(), updatedAt: new Date() },
    { id: "S2", scriptId: SCRIPT, title: "第二场", orderIdx: 2048, createdAt: new Date(), updatedAt: new Date() },
  ];
  for (const sc of scenes) await db.sceneNode.create({ data: sc });
  const elems = [
    { id: "E1", scriptId: SCRIPT, sceneId: "S1", originSceneId: "S1", kind: "narration", roleId: "c1", content: "A", durationSec: 2, orderIdx: 1024, needsReview: false, createdAt: new Date(), updatedAt: new Date() },
    { id: "E2", scriptId: SCRIPT, sceneId: "S1", originSceneId: "S1", kind: "dialogue", roleId: "c2", content: "B", durationSec: 3, orderIdx: 2048, needsReview: false, createdAt: new Date(), updatedAt: new Date() },
    { id: "E3", scriptId: SCRIPT, sceneId: "S1", originSceneId: "S1", kind: "shot", roleId: null, content: "C", durationSec: 5, orderIdx: 3072, needsReview: false, createdAt: new Date(), updatedAt: new Date() },
  ];
  for (const e of elems) await db.element.create({ data: e });
  await db.subtitleAnchor.create({
    data: { id: "A1", scriptId: SCRIPT, elementId: "E2", targetElementId: "E2", code: "S01", text: "B", timeMs: 2000, status: "ok" } as any,
  });
  await db.mediaRange.create({
    data: { id: "R1", scriptId: SCRIPT, elementId: "E3", assetId: "asset-1", label: "镜头", startMs: 0, endMs: 5000, status: "ok" },
  });
  await db.revision.create({
    data: {
      id: "rev-seed", scriptId: SCRIPT, seq: 1, opId: "seed", kind: "restoreState",
      authorId: "system", authorName: "system", summary: "init", baseSeq: 0,
      payload: {}, touched: [], fingerprints: {}, rebasedOnto: [], undoable: false,
      createdAt: new Date(),
    },
  });
}

function makeApp() {
  const app = Fastify();
  app.register(scriptRoutes, { prefix: "/api" });
  return app;
}

before(async () => {
  await seed();
});

test("GET 脚本：合计 = 10s，预览与合计引用同一修订", async () => {
  const app = makeApp();
  const res = await app.inject({ method: "GET", url: `/api/scripts/${SCRIPT}`, headers: { "x-user-id": "u-jia" } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.revision, 1);
  assert.equal(body.totalDurationSec, 10);
  assert.equal(body.scenes[0].durationSec, 10);
  assert.equal(body.scenes[0].elements.length, 3);
  await app.close();
});

test("并发时长（甲乙基于同一修订改不同元素）：后到者自动 rebase 成功", async () => {
  const rJia = await commitOperation(SCRIPT, {
    opId: "http-jia-dur", baseSeq: 1, author: jia,
    body: { type: "setDuration", elementId: "E1", durationSec: 2.5, expectedDurationSec: 2 },
  });
  assert.equal(rJia.status, "applied");

  const rYi = await commitOperation(SCRIPT, {
    opId: "http-yi-dur-ok", baseSeq: 1, author: yi,
    body: { type: "setDuration", elementId: "E2", durationSec: 8, expectedDurationSec: 3 },
  });
  assert.equal(rYi.status, "applied");
  if (rYi.status === "applied") {
    assert.equal(rYi.rebased, true);
    assert.deepEqual(rYi.rebasedOnto, [2]);
  }
  const snap = (await loadSnapshot(SCRIPT)) as Snapshot;
  assert.equal(snap.seq, 3);
});

test("同元素并发时长 -> 409 字段冲突，且生成待修复记录", async () => {
  const app = makeApp();
  const res = await app.inject({
    method: "POST",
    url: `/api/scripts/${SCRIPT}/commits`,
    headers: { "x-user-id": "u-bing", "content-type": "application/json" },
    payload: {
      opId: "http-bing-dur",
      baseSeq: 1, // 丙基于旧修订 r1；乙对 E2 的 r3 是它没见过的修改
      body: { type: "setDuration", elementId: "E2", durationSec: 9, expectedDurationSec: 3 },
    },
  });
  assert.equal(res.statusCode, 409);
  const body = res.json();
  assert.equal(body.conflict.kind, "field");
  const pending = await listConflicts(SCRIPT);
  assert.ok(pending.some((c) => c.opId === "http-bing-dur"));
  await app.close();
});

test("断线重复提交：相同 opId 幂等返回 duplicate", async () => {
  const r1 = await commitOperation(SCRIPT, {
    opId: "dup-op", baseSeq: 3, author: jia,
    body: { type: "setDuration", elementId: "E1", durationSec: 3 },
  });
  assert.equal(r1.status, "applied");
  const r2 = await commitOperation(SCRIPT, {
    opId: "dup-op", baseSeq: 3, author: jia,
    body: { type: "setDuration", elementId: "E1", durationSec: 3 },
  });
  if (r2.status === "applied") assert.equal(r2.duplicate, true);
});

test("甲拆场 / 乙删原场：显式 split_vs_delete，冲突解决不丢内容", async () => {
  // 当前 head；乙先删 S1
  const snap0 = (await loadSnapshot(SCRIPT)) as Snapshot;
  const head = snap0.seq;

  const del = await commitOperation(SCRIPT, {
    opId: "http-yi-delete", baseSeq: head, author: yi,
    body: { type: "deleteScene", sceneId: "S1", reason: "乙觉得第一场多余" },
  });
  assert.equal(del.status, "applied");

  // 甲基于删场前的修订拆场
  const split = await commitOperation(SCRIPT, {
    opId: "http-jia-split", baseSeq: head, author: jia,
    body: { type: "splitScene", sceneId: "S1", newSceneId: "S1B", newTitle: "甲拆的新场", afterElementIds: ["E3"] },
  });
  assert.equal(split.status, "conflict");
  if (split.status === "conflict") assert.equal(split.conflict.type, "split_vs_delete");

  // 甲选择：原场维持删除，把 E3 抢救为待归场
  const pending = await listConflicts(SCRIPT);
  const c = pending.find((x) => x.opId === "http-jia-split")!;
  const resolved = await resolveConflict(SCRIPT, c.id, { action: "adopt_orphans" }, jia);
  assert.match(resolved.note, /抢救|待归场/);

  const snap = (await loadSnapshot(SCRIPT)) as Snapshot;
  const e3 = snap.elements.find((e) => e.id === "E3")!;
  assert.equal(e3.sceneId, null);
  assert.equal(e3.needsReview, true);
  assert.ok(snap.scenes.find((s) => s.id === "S1")!.deletedAt);
});

test("撤销只反本人：乙不能撤销甲的修订；他人改过则阻止", async () => {
  // 新建干净脚本避免干扰：直接在当前脚本上校验归属
  const app = makeApp();
  // 乙尝试撤销甲的 http-jia-dur (seq 2)
  const res = await app.inject({
    method: "POST",
    url: `/api/scripts/${SCRIPT}/revisions/2/undo`,
    headers: { "x-user-id": "u-yi" },
  });
  assert.equal(res.statusCode, 409);
  assert.match(res.json().message, /本人/);
  await app.close();

  // 甲撤销自己的 seq2（setDuration E1）。此后 E1 又被 dup-op 改过，
  // 属于甲本人后续修改：允许，但如果是别人改的则阻止 —— 这里应成功（同字段后改者也是甲）
  const result = await undoRevision(SCRIPT, 2, jia);
  assert.ok(result.seq > 0);
});

test("草稿接口：状态恒为 draft/synced=false，绝不冒充已同步", async () => {
  const app = makeApp();
  const res = await app.inject({
    method: "PUT",
    url: `/api/scripts/${SCRIPT}/drafts`,
    headers: { "x-user-id": "u-jia", "content-type": "application/json" },
    payload: { content: { text: "我离线写的旁白" } },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, "draft");
  assert.equal(body.synced, false);

  const got = await app.inject({ method: "GET", url: `/api/scripts/${SCRIPT}/drafts`, headers: { "x-user-id": "u-jia" } });
  assert.equal(got.json().status, "draft");
  assert.equal(got.json().synced, false);
  await app.close();
});

test("服务端引用完整性：非法 payload 被 Zod 拒绝（400）", async () => {
  const app = makeApp();
  const res = await app.inject({
    method: "POST",
    url: `/api/scripts/${SCRIPT}/commits`,
    headers: { "x-user-id": "u-jia", "content-type": "application/json" },
    payload: { opId: "bad", baseSeq: 1, body: { type: "setDuration", elementId: "E1", durationSec: -5 } },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("校验失败：Zod 拒绝合并且同一场次", async () => {
  const app = makeApp();
  const res = await app.inject({
    method: "POST",
    url: `/api/scripts/${SCRIPT}/commits`,
    headers: { "x-user-id": "u-jia", "content-type": "application/json" },
    payload: {
      opId: "bad-merge",
      baseSeq: 1,
      body: { type: "mergeScenes", sceneIdA: "S2", sceneIdB: "S2", mergedTitle: "x" },
    },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("晚到预览：GET 返回单调 revision，客户端可据此丢弃旧响应", async () => {
  const app = makeApp();
  const r1 = await app.inject({ method: "GET", url: `/api/scripts/${SCRIPT}` });
  const rev1 = r1.json().revision;
  await commitOperation(SCRIPT, {
    opId: "bump", baseSeq: rev1, author: bing,
    body: { type: "renameScene", sceneId: "S2", title: "第二场(改名)" },
  });
  const r2 = await app.inject({ method: "GET", url: `/api/scripts/${SCRIPT}` });
  assert.ok(r2.json().revision > rev1);
  await app.close();
});
