import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apply,
  canUndo,
  orderedScenes,
  cloneSnapshot,
  commit,
  EngineError,
  fingerprints,
  sceneDurationSec,
  scriptTotalSec,
  touchedBy,
  validate,
} from "../src/domain/engine.js";
import type {
  Element,
  Operation,
  RevisionRecord,
  Snapshot,
} from "../src/domain/types.js";

const jia = { id: "u-jia", name: "甲" };
const yi = { id: "u-yi", name: "乙" };

let snapshotTemplate: Snapshot;
function makeSnapshot(): Snapshot {
  snapshotTemplate ??= {
    scriptId: "s1",
    seq: 1,
    characters: [
      { id: "c1", name: "旁白", color: "#000", orderIdx: 1024 },
      { id: "c2", name: "林溪", color: "#eee", orderIdx: 2048 },
    ],
    scenes: [
      { id: "S1", orderIdx: 1024, title: "第一场" },
      { id: "S2", orderIdx: 2048, title: "第二场" },
    ],
    elements: [
      { id: "E1", sceneId: "S1", kind: "narration", roleId: "c1", content: "A", durationSec: 2, orderIdx: 1024 },
      { id: "E2", sceneId: "S1", kind: "dialogue", roleId: "c2", content: "B", durationSec: 3, orderIdx: 2048 },
      { id: "E3", sceneId: "S1", kind: "shot", roleId: null, content: "C", durationSec: 5, orderIdx: 3072 },
      { id: "E4", sceneId: "S2", kind: "narration", roleId: "c1", content: "D", durationSec: 4, orderIdx: 1024 },
    ],
    anchors: [
      { id: "A1", elementId: "E2", targetElementId: "E2", code: "S01", text: "B", timeMs: 2000, status: "ok" },
    ],
    ranges: [
      { id: "R1", elementId: "E3", assetId: "asset-1", label: "镜头素材", startMs: 0, endMs: 5000, status: "ok" },
    ],
  };
  return JSON.parse(JSON.stringify(snapshotTemplate)) as Snapshot;
}

function op(author: { id: string; name: string }, baseSeq: number, body: Operation["body"], opId = Math.random().toString(36).slice(2)): Operation {
  return { opId, baseSeq, author, body };
}

/** 提交并登记修订记录（模拟服务层） */
function pushHistory(history: RevisionRecord[], snap: Snapshot, operation: Operation, result: { seq: number; rebased: boolean; rebasedOnto: number[] }) {
  const touches = touchedBy(operation.body, snap);
  history.push({
    seq: result.seq,
    opId: operation.opId,
    kind: operation.body.type as RevisionRecord["kind"],
    author: operation.author,
    summary: operation.body.type,
    baseSeq: operation.baseSeq,
    payload: operation,
    touched: touches,
    fingerprints: fingerprints(snap, touches),
    rebasedFrom: result.rebased ? operation.baseSeq : null,
    rebasedOnto: result.rebasedOnto,
    undoable: true,
    createdAt: new Date().toISOString(),
  });
}

test("初始合计等于各场次元素时长之和", () => {
  const s = makeSnapshot();
  assert.equal(sceneDurationSec(s, "S1"), 10);
  assert.equal(scriptTotalSec(s), 14);
});

test("并发调整不同元素时长：自动 rebase，双方都生效", () => {
  const s = makeSnapshot();
  const history: RevisionRecord[] = [];

  // 甲基于 seq1 改 E1=2->2.5；乙基于 seq1 改 E2=3->8
  const opJia = op(jia, 1, { type: "setDuration", elementId: "E1", durationSec: 2.5, expectedDurationSec: 2 });
  const r1 = commit(s, history, opJia);
  assert.equal(r1.status, "applied");
  pushHistory(history, s, opJia, r1 as { seq: number; rebased: boolean; rebasedOnto: number[] });

  const opYi = op(yi, 1, { type: "setDuration", elementId: "E2", durationSec: 8, expectedDurationSec: 3 });
  const r2 = commit(s, history, opYi);
  assert.equal(r2.status, "applied");
  if (r2.status === "applied") {
    assert.equal(r2.rebased, true);
    assert.deepEqual(r2.rebasedOnto, [2]);
  }
  assert.equal(scriptTotalSec(s), 2.5 + 8 + 5 + 4);
});

test("并发调整同一元素时长：字段级显式冲突", () => {
  const s = makeSnapshot();
  const history: RevisionRecord[] = [];
  const opJia = op(jia, 1, { type: "setDuration", elementId: "E1", durationSec: 2.5, expectedDurationSec: 2 });
  const r1 = commit(s, history, opJia);
  pushHistory(history, s, opJia, r1 as { seq: number; rebased: boolean; rebasedOnto: number[] });

  const opYi = op(yi, 1, { type: "setDuration", elementId: "E1", durationSec: 9, expectedDurationSec: 2 });
  const r2 = commit(s, history, opYi);
  assert.equal(r2.status, "conflict");
  if (r2.status === "conflict") {
    assert.equal(r2.conflict.kind, "field");
    if (r2.conflict.kind === "field") {
      assert.equal(r2.conflict.field, "durationSec");
      assert.equal(r2.conflict.incoming, 9);
      assert.equal(r2.conflict.existing, 2.5);
    }
  }
  // 冲突不改变快照
  assert.equal(s.seq, 2);
  assert.equal(s.elements.find((e) => e.id === "E1")!.durationSec, 2.5);
});

test("拆场：元素/锚点/素材跟随稳定身份迁移，不依赖下标", () => {
  const s = makeSnapshot();
  const split = op(jia, 1, {
    type: "splitScene",
    sceneId: "S1",
    newSceneId: "S1B",
    newTitle: "第一场上半",
    afterElementIds: ["E3"],
    splitAtMs: 5000,
  });
  apply(s, split);

  const e3 = s.elements.find((e) => e.id === "E3")!;
  assert.equal(e3.sceneId, "S1B");
  assert.equal(e3.originSceneId, "S1");
  // 留在原场的元素不变
  assert.equal(s.elements.find((e) => e.id === "E1")!.sceneId, "S1");
  // 新场紧跟原场（顺序永远由 orderIdx 决定，与存储数组位置无关）
  const orders = orderedScenes(s).map((x) => x.id);
  assert.deepEqual(orders.slice(0, 3), ["S1", "S1B", "S2"]);
  // 锚点/区间跟随 E3 的身份并标待确认，引用不悬空
  assert.equal(s.anchors.find((a) => a.id === "A1")!.targetElementId, "E2");
  assert.equal(s.ranges.find((r) => r.id === "R1")!.elementId, "E3");
  assert.equal(s.ranges.find((r) => r.id === "R1")!.status, "review");
  validate(s);
});

test("甲拆场 / 乙删除原场 -> 显式结构冲突，原操作保留不丢", () => {
  // 共同祖先 seq1
  const base = makeSnapshot();
  const history: RevisionRecord[] = [];

  // 乙的世界线：删 S1
  const sYi = cloneSnapshot(base);
  const del = op(yi, 1, { type: "deleteScene", sceneId: "S1" }, "op-yi-del");
  apply(sYi, del);
  sYi.seq = 2;
  pushHistory(history, sYi, del, { seq: 2, rebased: false, rebasedOnto: [] });

  // 甲基于 seq1 提交拆场 -> 在乙的 head 上 rebase
  const split = op(jia, 1, {
    type: "splitScene",
    sceneId: "S1",
    newSceneId: "S1B",
    newTitle: "拆出",
    afterElementIds: ["E3"],
  }, "op-jia-split");
  const r = commit(sYi, history, split);
  assert.equal(r.status, "conflict");
  if (r.status === "conflict") {
    assert.equal(r.conflict.kind, "structural");
    if (r.conflict.kind === "structural") {
      assert.equal(r.conflict.type, "split_vs_delete");
      assert.ok(r.conflict.sceneIds.includes("S1"));
      // 原操作完整保留在冲突里
      assert.equal((r.conflict.op.body as { type: string }).type, "splitScene");
    }
  }
  // 乙的删除结果没有被甲的迟到操作破坏
  assert.ok(sYi.scenes.find((x) => x.id === "S1")!.deletedAt);
  // E3 因删场成为待归场孤儿，而不是消失
  const e3 = sYi.elements.find((x) => x.id === "E3")!;
  assert.equal(e3.needsReview, true);
});

test("撤销：本人后续修改可撤销并给出提示；他人修改硬阻止，不能抹掉台词", () => {
  const s = makeSnapshot();
  const history: RevisionRecord[] = [];

  // seq2 甲改 E2 台词 B -> B2
  const edit = op(jia, 1, { type: "editElement", elementId: "E2", fields: { content: "B2" }, expected: { content: "B" } }, "op-jia-edit");
  const r1 = commit(s, history, edit);
  pushHistory(history, s, edit, r1 as { seq: number; rebased: boolean; rebasedOnto: number[] });
  assert.equal(s.elements.find((e) => e.id === "E2")!.content, "B2");

  // seq3 乙又改 E2 台词 B2 -> B3
  const editYi = op(yi, 2, { type: "editElement", elementId: "E2", fields: { content: "B3" }, expected: { content: "B2" } }, "op-yi-edit");
  const r2 = commit(s, history, editYi);
  pushHistory(history, s, editYi, r2 as { seq: number; rebased: boolean; rebasedOnto: number[] });

  const target = history.find((h) => h.opId === "op-jia-edit")!;
  const check = canUndo(s, history, target, jia.id);
  assert.equal(check.ok, false);
  assert.ok(check.blockers.some((b) => b.by === "乙" && b.detail.includes("已阻止")));

  // 甲不能撤销别人的操作
  const targetYi = history.find((h) => h.opId === "op-yi-edit")!;
  const check2 = canUndo(s, history, targetYi, jia.id);
  assert.equal(check2.ok, false);
  assert.match(check2.reason ?? "", /本人/);
});

test("撤销：他人只动了别的元素时，本人撤销安全", () => {
  const s = makeSnapshot();
  const history: RevisionRecord[] = [];
  const editJia = op(jia, 1, { type: "editElement", elementId: "E1", fields: { content: "A2" }, expected: { content: "A" } }, "op-jia-e1");
  const r1 = commit(s, history, editJia);
  pushHistory(history, s, editJia, r1 as { seq: number; rebased: boolean; rebasedOnto: number[] });

  const editYi = op(yi, 2, { type: "editElement", elementId: "E2", fields: { content: "B2" }, expected: { content: "B" } }, "op-yi-e2");
  const r2 = commit(s, history, editYi);
  pushHistory(history, s, editYi, r2 as { seq: number; rebased: boolean; rebasedOnto: number[] });

  const target = history.find((h) => h.opId === "op-jia-e1")!;
  const check = canUndo(s, history, target, jia.id);
  assert.equal(check.ok, true);
});

test("删除元素：字幕锚点变 broken、素材区间变 review，不悬空不级联删除", () => {
  const s = makeSnapshot();
  apply(s, op(jia, 1, { type: "deleteElement", elementId: "E2" }));
  const a1 = s.anchors.find((a) => a.id === "A1")!;
  assert.equal(a1.status, "broken");
  assert.ok(a1.note?.includes("删除"));
  validate(s);
});

test("引用完整性：元素指向不存在场次时报错", () => {
  const s = makeSnapshot();
  (s.elements.find((e) => e.id === "E1")! as Element).sceneId = "GONE";
  assert.throws(() => validate(s), EngineError);
});

test("素材区间跨越拆分边界 -> review，禁止自动裁剪", () => {
  const s = makeSnapshot();
  // 让 R1 横跨 E2/E3 边界
  s.ranges[0] = { id: "R1", elementId: null, assetId: "a", label: "x", startMs: 4000, endMs: 6000, status: "ok" };
  apply(s, op(jia, 1, { type: "splitScene", sceneId: "S1", newSceneId: "S1B", newTitle: "半", afterElementIds: ["E3"], splitAtMs: 5000 }));
  assert.equal(s.ranges.find((r) => r.id === "R1")!.status, "review");
});

test("合场后撤销原合场所需身份都保留（软删墓碑可恢复）", () => {
  const s = makeSnapshot();
  apply(s, op(jia, 1, { type: "mergeScenes", sceneIdA: "S1", sceneIdB: "S2", mergedTitle: "合并场" }));
  const s2 = s.scenes.find((x) => x.id === "S2")!;
  assert.ok(s2.deletedAt);
  // 元素全部归 S1
  assert.ok(s.elements.every((e) => e.sceneId === "S1"));
  // 恢复墓碑
  apply(s, op(jia, 2, {
    type: "restoreState",
    reason: "undo merge",
    scenes: [{ id: "S2", orderIdx: 2048, title: "第二场", deletedAt: null }],
    elements: [
      { id: "E4", sceneId: "S2", kind: "narration", roleId: "c1", content: "D", durationSec: 4, orderIdx: 1024 },
    ],
  }));
  assert.ok(!s.scenes.find((x) => x.id === "S2")!.deletedAt);
  assert.equal(s.elements.find((e) => e.id === "E4")!.sceneId, "S2");
});

test("断线重复提交：服务层按 opId 幂等（引擎层重复 op 不会二次计数的前提是同 baseSeq 已线性化）", () => {
  const s = makeSnapshot();
  const history: RevisionRecord[] = [];
  const edit = op(jia, 1, { type: "setDuration", elementId: "E1", durationSec: 6 }, "fixed-op-id");
  const r1 = commit(s, history, edit);
  assert.equal(r1.status, "applied");
  pushHistory(history, s, edit, r1 as { seq: number; rebased: boolean; rebasedOnto: number[] });
  // 同一操作重发但携带新 baseSeq=2（客户端已收到首次结果后的重发）：值相同 -> 不产生冲突
  const retry = { ...edit, baseSeq: 2 };
  const r2 = commit(s, history, retry);
  assert.equal(r2.status, "applied");
});

test("晚到的旧预览响应：客户端按 revision 号丢弃（引擎提供单调 seq 依据）", () => {
  const s = makeSnapshot();
  const revAtFetch = s.seq; // 1
  const history: RevisionRecord[] = [];
  const edit = op(jia, 1, { type: "setDuration", elementId: "E1", durationSec: 6 });
  const r = commit(s, history, edit);
  pushHistory(history, s, edit, r as { seq: number; rebased: boolean; rebasedOnto: number[] });
  // 模拟前端比较：旧响应 revision <= 当前已展示 revision 则丢弃
  assert.ok(revAtFetch < s.seq);
});

test("delete_vs_edit：乙删场、甲刚改过场内元素 -> 显式冲突", () => {
  const base = makeSnapshot();
  const history: RevisionRecord[] = [];
  // 甲先改 S1 的 E1
  const sJia = cloneSnapshot(base);
  const edit = op(jia, 1, { type: "editElement", elementId: "E1", fields: { content: "A-new" }, expected: { content: "A" } }, "jia-e1");
  const r1 = commit(sJia, history, edit);
  pushHistory(history, sJia, edit, r1 as { seq: number; rebased: boolean; rebasedOnto: number[] });
  // 乙基于 seq1 删 S1
  const del = op(yi, 1, { type: "deleteScene", sceneId: "S1" }, "yi-del");
  const r2 = commit(sJia, history, del);
  assert.equal(r2.status, "conflict");
  if (r2.status === "conflict" && r2.conflict.kind === "structural") {
    assert.equal(r2.conflict.type, "delete_vs_edit");
  }
});

test("同值并发编辑殊途同归：不产生冲突", () => {
  const s = makeSnapshot();
  const history: RevisionRecord[] = [];
  const a = op(jia, 1, { type: "editElement", elementId: "E1", fields: { content: "X" }, expected: { content: "A" } });
  const r1 = commit(s, history, a);
  pushHistory(history, s, a, r1 as { seq: number; rebased: boolean; rebasedOnto: number[] });
  const b = op(yi, 1, { type: "editElement", elementId: "E1", fields: { content: "X" }, expected: { content: "A" } });
  const r2 = commit(s, history, b);
  assert.equal(r2.status, "applied");
});

test("非法拆场（迁移空集/全集）被拒绝", () => {
  const s = makeSnapshot();
  assert.throws(
    () => apply(s, op(jia, 1, { type: "splitScene", sceneId: "S1", newSceneId: "X", newTitle: "x", afterElementIds: [] })),
    EngineError,
  );
  assert.throws(
    () => apply(s, op(jia, 1, { type: "splitScene", sceneId: "S1", newSceneId: "Y", newTitle: "y", afterElementIds: ["E1", "E2", "E3"] })),
    EngineError,
  );
});

test("删场后节点成为待归场孤儿，reattachElement 按身份归回", () => {
  const s = makeSnapshot();
  apply(s, op(yi, 1, { type: "deleteScene", sceneId: "S1", reason: "乙删场" }));
  const e1 = s.elements.find((x) => x.id === "E1")!;
  assert.equal(e1.sceneId, null);
  assert.equal(e1.needsReview, true);

  apply(s, op(jia, 2, { type: "reattachElement", elementId: "E1", sceneId: "S2" }));
  const after = s.elements.find((x) => x.id === "E1")!;
  assert.equal(after.sceneId, "S2");
  assert.equal(after.needsReview, false);
  validate(s);
});

test("reattach 到已删场次 -> 结构冲突", () => {
  const s = makeSnapshot();
  const history: RevisionRecord[] = [];
  // 乙删 S2
  const del = op(yi, 1, { type: "deleteScene", sceneId: "S2" }, "del-s2");
  const r1 = commit(s, history, del);
  pushHistory(history, s, del, r1 as { seq: number; rebased: boolean; rebasedOnto: number[] });
  // 甲基于旧修订把元素归到 S2
  const reattach = op(jia, 1, { type: "reattachElement", elementId: "E1", sceneId: "S2" });
  const r2 = commit(s, history, reattach);
  assert.equal(r2.status, "conflict");
  if (r2.status === "conflict" && r2.conflict.kind === "structural") {
    assert.equal(r2.conflict.type, "merge_vs_delete");
  }
});
