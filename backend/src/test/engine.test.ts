import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRepository } from "../domain/memRepo.js";
import { ScriptService } from "../domain/service.js";
import { seedIfEmpty } from "../db/seed.js";
import type { Doc, Operation } from "../domain/types.js";

const SID = "demo-script";

async function setup(): Promise<{ service: ScriptService; repo: InMemoryRepository }> {
  const repo = new InMemoryRepository();
  await seedIfEmpty(repo);
  return { service: new ScriptService(repo), repo };
}

const op = (partial: Partial<Operation> & Pick<Operation, "type" | "author" | "payload">): Operation => ({
  opId: `${partial.author}-${Math.random().toString(36).slice(2, 9)}`,
  baseRev: 0,
  ...partial,
});

const withRev = async (service: ScriptService, baseRev: number, o: Operation, overrideBase?: number) =>
  service.commit(SID, { ...o, baseRev: overrideBase ?? baseRev });

describe("拆场：稳定身份跟随", () => {
  it("拆分后角色/台词/镜头/锚点使用稳定 id 迁移，跨切点引用进入待修复", async () => {
    const { service, repo } = await setup();
    // 在 7000ms 处拆 sc_02（镜头 7000 + 5000），第一镜头完整落 head
    const r = await withRev(service, 0, op({
      author: "甲",
      type: "scene.split",
      payload: { sceneId: "sc_02", cutMs: 7000, headHeading: "湖畔", tailHeading: "相遇", lineSide: { ln_03: "head", ln_04: "tail" } },
    }));
    expect(r.result.status).toBe("accepted");
    const doc = (await repo.getDoc(SID))!;
    const children = doc.scenes.filter((s) => s.parentSceneId === "sc_02" && !s.deleted);
    expect(children).toHaveLength(2);
    const [head, tail] = children.sort((a, b) => a.index - b.index);

    // 稳定 id 不变，只是换了 sceneId
    const ln3 = doc.lines.find((l) => l.id === "ln_03")!;
    const ln4 = doc.lines.find((l) => l.id === "ln_04")!;
    expect(ln3.sceneId).toBe(head.id);
    expect(ln4.sceneId).toBe(tail.id);
    const sh3 = doc.shots.find((x) => x.id === "sh_03")!;
    const sh4 = doc.shots.find((x) => x.id === "sh_04")!;
    expect(sh3.sceneId).toBe(head.id);
    expect(sh4.sceneId).toBe(tail.id);
    expect(sh4.needsRepair).toBe(false); // 非跨切点镜头只承载时长，不待修复

    // 锚点跟随引用的稳定 id
    const an2 = doc.anchors.find((a) => a.id === "an_02")!;
    expect(an2.sceneId).toBe(head.id);
    expect(an2.refId).toBe("sh_03");

    // 素材区间完整落在 head，区间与切点相交才需修复：lake_walk 0..12000 跨 7000
    const mat = doc.materials.find((m) => m.id === "mt_03")!;
    expect(mat.needsRepair).toBe(true);
    expect(mat.sceneId).toBe(head.id);

    // 原场软删除且可追溯
    expect(doc.scenes.find((s) => s.id === "sc_02")!.deleted).toBe(true);
  });

  it("未指定台词归属时进入待修复而非随意丢弃", async () => {
    const { service, repo } = await setup();
    await withRev(service, 0, op({ author: "甲", type: "scene.split", payload: { sceneId: "sc_01", cutMs: 6000 } }));
    const doc = (await repo.getDoc(SID))!;
    const pending = doc.lines.filter((l) => l.needsRepair);
    expect(pending.length).toBeGreaterThan(0);
  });
});

describe("离线恢复：甲拆场、乙删除原场", () => {
  it("基于旧修订拆分已被删除的原场 → 显式冲突，内容隔离保留，可裁决", async () => {
    const { service, repo } = await setup();
    // 乙先删 sc_01
    const del = await withRev(service, 0, op({ author: "乙", type: "scene.delete", payload: { sceneId: "sc_01" } }));
    expect(del.result.status).toBe("accepted");
    let doc = (await repo.getDoc(SID))!;
    expect(doc.headRev).toBe(1);

    // 甲离线期间基于 rev=0 拆分 sc_01，恢复后提交（baseRev 落后）
    const split = await withRev(service, 1, op({
      author: "甲",
      type: "scene.split",
      payload: { sceneId: "sc_01", cutMs: 6000, lineSide: { ln_01: "head", ln_02: "tail" } },
    }), 0);
    expect(split.result.status).toBe("conflict");
    expect(split.result.conflictId).toBeTruthy();
    expect(split.rebased).toBe(true); // 明确告知变基，而非静默
    doc = (await repo.getDoc(SID))!;
    const conflict = doc.conflicts.find((c) => c.id === split.result.conflictId)!;
    expect(conflict.kind).toBe("split_deleted_parent");
    expect(conflict.status).toBe("open");

    // 甲的台词内容仍在（隔离在 pending_orphan 子场中），没有无声丢失
    const orphans = doc.scenes.filter((s) => s.status === "pending_orphan");
    expect(orphans).toHaveLength(2);
    const keptLines = doc.lines.filter((l) => l.id === "ln_01" || l.id === "ln_02");
    expect(keptLines).toHaveLength(2);
    expect(keptLines.every((l) => orphans.some((o) => o.id === l.sceneId))).toBe(true);

    // 裁决 keep_split：子场恢复在场，父场维持删除
    const res = await withRev(service, doc.headRev, op({
      author: "甲",
      type: "conflict.resolve",
      payload: { conflictId: conflict.id, resolution: "keep_split" },
    }));
    expect(res.result.status).toBe("accepted");
    doc = (await repo.getDoc(SID))!;
    expect(doc.scenes.filter((s) => s.parentSceneId === "sc_01" && !s.deleted && s.status === "active")).toHaveLength(2);
    expect(doc.scenes.find((s) => s.id === "sc_01")!.deleted).toBe(true);
  });

  it("先拆后删（在线竞态）：delete 被提升为 delete_has_children 冲突", async () => {
    const { service, repo } = await setup();
    await withRev(service, 0, op({ author: "甲", type: "scene.split", payload: { sceneId: "sc_01", cutMs: 6000, lineSide: { ln_01: "head", ln_02: "tail" } } }));
    const del = await withRev(service, 1, op({ author: "乙", type: "scene.delete", payload: { sceneId: "sc_01" } }));
    expect(del.result.status).toBe("conflict");
    const doc = (await repo.getDoc(SID))!;
    expect(doc.conflicts.some((c) => c.kind === "delete_has_children" && c.status === "open")).toBe(true);
    // 删除未生效
    const children = doc.scenes.filter((s) => s.parentSceneId === "sc_01" && !s.deleted);
    expect(children).toHaveLength(2);
  });
});

describe("并发调整时长", () => {
  it("两人改不同字段/同字段，最后写入在最新修订上变基重放，修订链完整", async () => {
    const { service, repo } = await setup();
    const o1 = await withRev(service, 0, op({ author: "甲", type: "edit.field", payload: { entityKind: "shot", entityId: "sh_03", fields: { durationMs: 9000 } } }));
    expect(o1.rev).toBe(1);
    // 乙基于 rev=0 改同一镜头的描述
    const o2 = await withRev(service, 1, op({ author: "乙", type: "edit.field", payload: { entityKind: "shot", entityId: "sh_03", fields: { description: "沿栈道逆光跟拍" } } }), 0);
    expect(o2.result.status).toBe("accepted");
    expect(o2.rebased).toBe(true);
    const doc = (await repo.getDoc(SID))!;
    const shot = doc.shots.find((s) => s.id === "sh_03")!;
    expect(shot.durationMs).toBe(9000); // 甲的修改保留
    expect(shot.description).toBe("沿栈道逆光跟拍"); // 乙的修改也保留
    const revs = await repo.revisions(SID);
    expect(revs).toHaveLength(2);
    expect(revs[0].payload.before).toMatchObject({ durationMs: 7000 }); // 旧值证据
  });
});

describe("断线重复提交", () => {
  it("相同 opId 重放返回同一修订号且不产生第二条记录", async () => {
    const { service, repo } = await setup();
    const shared: Operation = { opId: "fixed-op-id", author: "甲", type: "scene.move", baseRev: 0, payload: { sceneId: "sc_01", toIndex: 2 } };
    const a = await service.commit(SID, shared);
    const b = await service.commit(SID, shared);
    expect(a.rev).toBe(b.rev);
    expect(b.duplicate).toBe(true);
    const revs = await repo.revisions(SID);
    expect(revs.filter((r) => r.opId === "fixed-op-id")).toHaveLength(1);
  });
});

describe("撤销语义", () => {
  it("不能撤销他人的意图", async () => {
    const { service } = await setup();
    const edit = await withRev(service, 0, op({ author: "甲", type: "edit.field", payload: { entityKind: "line", entityId: "ln_01", fields: { text: "甲改过的旁白" } } }));
    const undo = await withRev(service, edit.rev, op({ author: "乙", type: "undo", payload: { revisionSeq: edit.rev } }));
    expect(undo.result.status).toBe("blocked");
    expect(undo.result.code).toBe("NOT_OWN_INTENT");
  });

  it("撤销本人编辑时，若他人随后改了同字段，必须拒绝，不能抹掉他人台词", async () => {
    const { service, repo } = await setup();
    const a = await withRev(service, 0, op({ author: "甲", type: "edit.field", payload: { entityKind: "line", entityId: "ln_01", fields: { text: "甲的版本" } } }));
    await withRev(service, a.rev, op({ author: "乙", type: "edit.field", payload: { entityKind: "line", entityId: "ln_01", fields: { text: "乙后来的台词" } } }));
    const undo = await withRev(service, 2, op({ author: "甲", type: "undo", payload: { revisionSeq: a.rev } }));
    expect(undo.result.status).toBe("blocked");
    expect(undo.result.code).toBe("FIELD_CONCURRENT_CHANGE");
    const doc = (await repo.getDoc(SID))!;
    expect(doc.lines.find((l) => l.id === "ln_01")!.text).toBe("乙后来的台词");
  });

  it("本人在无人竞争时可以撤销自己的编辑，恢复旧值", async () => {
    const { service, repo } = await setup();
    const a = await withRev(service, 0, op({ author: "甲", type: "edit.field", payload: { entityKind: "line", entityId: "ln_01", fields: { text: "新文本" } } }));
    const undo = await withRev(service, a.rev, op({ author: "甲", type: "undo", payload: { revisionSeq: a.rev } }));
    expect(undo.result.status).toBe("accepted");
    const doc = (await repo.getDoc(SID))!;
    expect(doc.lines.find((l) => l.id === "ln_01")!.text).toBe("这里是城市边缘的一片绿洲。");
  });

  it("撤销拆分在他人编辑过子场时被拒绝", async () => {
    const { service } = await setup();
    const split = await withRev(service, 0, op({ author: "甲", type: "scene.split", payload: { sceneId: "sc_01", cutMs: 6000, lineSide: { ln_01: "head", ln_02: "tail" } } }));
    await withRev(service, split.rev, op({ author: "乙", type: "edit.field", payload: { entityKind: "line", entityId: "ln_02", fields: { text: "乙加的台词" } } }));
    const undo = await withRev(service, 2, op({ author: "甲", type: "undo", payload: { revisionSeq: split.rev } }));
    expect(undo.result.status).toBe("blocked");
    expect(undo.result.code).toBe("OTHERS_EDITED_CHILD");
  });
});

describe("节点迁移与引用完整性", () => {
  it("move 只改顺序，所有引用靠稳定 id 保持；合计时长不变", async () => {
    const { service, repo } = await setup();
    const before = (await repo.getDoc(SID))!;
    const totalBefore = before.shots.reduce((a, s) => a + s.durationMs, 0);
    await withRev(service, 0, op({ author: "甲", type: "scene.move", payload: { sceneId: "sc_01", toIndex: 2 } }));
    const after = (await repo.getDoc(SID))!;
    const order = after.scenes.filter((s) => !s.deleted).sort((a, b) => a.index - b.index).map((s) => s.id);
    expect(order).toEqual(["sc_02", "sc_03", "sc_01"]);
    const totalAfter = after.shots.reduce((a, s) => a + s.durationMs, 0);
    expect(totalAfter).toBe(totalBefore);
    // 台词引用未被移动影响
    expect(after.lines.find((l) => l.id === "ln_01")!.sceneId).toBe("sc_01");
  });

  it("引用一个不存在的场次进行修复会被服务端拒绝", async () => {
    const { service } = await setup();
    const split = await withRev(service, 0, op({ author: "甲", type: "scene.split", payload: { sceneId: "sc_01", cutMs: 6000 } }));
    void split;
    const doc = (await service.repo.getDoc(SID)) as Doc;
    const pending = doc.lines.find((l) => l.needsRepair)!;
    const r = await withRev(service, doc.headRev, op({ author: "甲", type: "repair.resolve", payload: { refType: "line", refId: pending.id, fields: { sceneId: "sc_999" } } }));
    expect(r.result.status).toBe("blocked");
  });
});

describe("合并与逆向", () => {
  it("合并相邻场后可由本人撤销，内容按证据回到来源场", async () => {
    const { service, repo } = await setup();
    const merge = await withRev(service, 0, op({ author: "甲", type: "scene.merge", payload: { sceneIds: ["sc_01", "sc_02"], heading: "晨湖" } }));
    expect(merge.result.status).toBe("accepted");
    const undo = await withRev(service, merge.rev, op({ author: "甲", type: "undo", payload: { revisionSeq: merge.rev } }));
    expect(undo.result.status).toBe("accepted");
    const doc = (await repo.getDoc(SID))!;
    const s1 = doc.scenes.find((s) => s.id === "sc_01")!;
    const s2 = doc.scenes.find((s) => s.id === "sc_02")!;
    expect(s1.deleted).toBe(false);
    expect(s2.deleted).toBe(false);
    expect(doc.lines.find((l) => l.id === "ln_01")!.sceneId).toBe("sc_01");
    expect(doc.lines.find((l) => l.id === "ln_03")!.sceneId).toBe("sc_02");
  });

  it("他人改过合并体镜头后，撤销合并被拒绝", async () => {
    const { service } = await setup();
    const merge = await withRev(service, 0, op({ author: "甲", type: "scene.merge", payload: { sceneIds: ["sc_01", "sc_02"], heading: "晨湖" } }));
    const doc0 = (await service.repo.getDoc(SID)) as Doc;
    const merged = doc0.scenes.find((x) => x.origin === "merge" && x.createdInRev === merge.rev)!;
    const shotIn = doc0.shots.find((x) => x.sceneId === merged.id)!;
    await withRev(service, merge.rev, op({ author: "乙", type: "edit.field", payload: { entityKind: "shot", entityId: shotIn.id, fields: { description: "乙改了合并体镜头" } } }));
    const undo = await withRev(service, merge.rev + 1, op({ author: "甲", type: "undo", payload: { revisionSeq: merge.rev } }));
    expect(undo.result.status).toBe("blocked");
    expect(undo.result.code).toBe("OTHERS_EDITED_MERGED");
  });

  it("不能合并不相邻的场次", async () => {
    const { service } = await setup();
    const r = await withRev(service, 0, op({ author: "甲", type: "scene.merge", payload: { sceneIds: ["sc_01", "sc_03"] } }));
    expect(r.result.status).toBe("blocked");
    expect(r.result.code).toBe("NOT_ADJACENT");
  });
});


describe("修订头与证据", () => {
  it("被拒绝的操作也占修订号并保留证据；随后的正常操作基于正确的新 head", async () => {
    const { service, repo } = await setup();
    const bad = await withRev(service, 0, op({ author: "甲", type: "edit.field", payload: { entityKind: "shot", entityId: "sh_01", fields: { durationMs: -1 } } }));
    expect(bad.result.status).toBe("blocked");
    expect(bad.rev).toBe(1); // 证据占号
    const doc1 = (await repo.getDoc(SID))!;
    expect(doc1.headRev).toBe(1);
    expect(doc1.shots.find((x) => x.id === "sh_01")!.durationMs).toBe(6000); // 非法值未写入

    const good = await withRev(service, 1, op({ author: "乙", type: "edit.field", payload: { entityKind: "shot", entityId: "sh_01", fields: { durationMs: 6500 } } }));
    expect(good.result.status).toBe("accepted");
    expect(good.rev).toBe(2);
    const revs = await repo.revisions(SID);
    expect(revs.map((r) => [r.seq, r.result.status])).toEqual([[1, "blocked"], [2, "accepted"]]);
  });

  it("结构冲突同样占号且可在冲突中心裁决后继续编辑", async () => {
    const { service } = await setup();
    const del = await withRev(service, 0, op({ author: "乙", type: "scene.delete", payload: { sceneId: "sc_01" } }));
    expect(del.rev).toBe(1);
    const split = await withRev(service, 1, op({
      author: "甲",
      type: "scene.split",
      payload: { sceneId: "sc_01", cutMs: 6000, lineSide: { ln_01: "head", ln_02: "tail" } },
    }), 0);
    expect(split.result.status).toBe("conflict");
    expect(split.rev).toBe(2);
    const res = await withRev(service, 2, op({ author: "甲", type: "conflict.resolve", payload: { conflictId: split.result.conflictId!, resolution: "keep_delete" } }));
    expect(res.rev).toBe(3);
    expect(res.result.status).toBe("accepted");
  });
});

describe("服务端校验", () => {
  it("非法字段/负时长被拒绝", async () => {
    const { service } = await setup();
    const r = await withRev(service, 0, op({ author: "甲", type: "edit.field", payload: { entityKind: "shot", entityId: "sh_01", fields: { durationMs: -5 } } }));
    expect(r.result.status).toBe("blocked");
    expect(r.result.code).toBe("BAD_NUMBER");
  });
});
