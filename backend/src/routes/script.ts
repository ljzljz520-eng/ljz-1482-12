/**
 * 脚本协作 API
 * 所有写操作要求：x-user-id 头；payload 通过 Zod 校验；
 * 引擎在 Serializable 事务内做引用完整性校验。
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { USERS, userFromHeader } from "../lib/users.js";
import {
  orderedScenes,
  orderedElements,
  sceneDurationSec,
  scriptTotalSec,
  EngineError,
} from "../domain/engine.js";
import { loadSnapshot } from "../services/snapshot.js";
import { loadHistory } from "../services/history.js";
import { commitOperation } from "../services/commits.js";
import { undoRevision, previewUndo } from "../services/undo.js";
import { listConflicts, resolveConflict } from "../services/conflicts.js";
import { parseOperation, resolveSchema } from "./validation.js";

function actorOf(req: { headers: Record<string, unknown> }) {
  return userFromHeader((req.headers["x-user-id"] as string) ?? undefined);
}

async function buildScriptView(scriptId: string) {
  const [snap, script, conflicts] = await Promise.all([
    loadSnapshot(scriptId),
    prisma.script.findUnique({ where: { id: scriptId } }),
    listConflicts(scriptId),
  ]);
  if (!snap || !script) return null;

  // 合计与预览卡都基于同一份快照计算，保证引用同一修订
  const scenes = orderedScenes(snap).map((sc) => {
    const elements = orderedElements(snap, sc.id);
    return {
      id: sc.id,
      title: sc.title,
      orderIdx: sc.orderIdx,
      durationSec: sceneDurationSec(snap, sc.id),
      elements: elements.map((e) => ({
        id: e.id,
        kind: e.kind,
        roleId: e.roleId,
        content: e.content,
        durationSec: e.durationSec,
        orderIdx: e.orderIdx,
        needsReview: e.needsReview,
        reviewReason: e.reviewReason,
        originSceneId: e.originSceneId,
      })),
    };
  });

  const orphanElements = snap.elements
    .filter((e) => !e.deletedAt && e.sceneId === null)
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      roleId: e.roleId,
      content: e.content,
      durationSec: e.durationSec,
      needsReview: e.needsReview,
      reviewReason: e.reviewReason,
      originSceneId: e.originSceneId,
    }));

  const reviewAnchors = snap.anchors.filter((a) => !a.deletedAt && a.status !== "ok");
  const reviewRanges = snap.ranges.filter((r) => !r.deletedAt && r.status !== "ok");

  return {
    id: script.id,
    title: script.title,
    description: script.description,
    revision: script.headSeq,
    updatedAt: script.updatedAt.toISOString(),
    totalDurationSec: scriptTotalSec(snap),
    sceneCount: scenes.length,
    elementCount: scenes.reduce((n, s) => n + s.elements.length, 0) + orphanElements.length,
    characters: snap.characters.filter((c) => !c.deletedAt),
    scenes,
    orphanElements,
    reviewItems: {
      anchors: reviewAnchors,
      ranges: reviewRanges,
    },
    pendingConflicts: conflicts,
  };
}

export async function scriptRoutes(app: FastifyInstance) {
  /** 当前用户（演示身份切换） */
  app.get("/users", async () => Object.values(USERS));

  /** 健康检查 */
  app.get("/health", async () => ({ ok: true, ts: Date.now() }));

  /** 脚本总览：合计与预览卡同一修订 */
  app.get("/scripts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const view = await buildScriptView(id);
    if (!view) return reply.code(404).send({ message: "脚本不存在" });
    return view;
  });

  /** 轻量轮询：只拿 headSeq，避免高频全量 */
  app.get("/scripts/:id/poll", async (req, reply) => {
    const { id } = req.params as { id: string };
    const since = Number((req.query as { since?: string }).since ?? -1);
    const script = await prisma.script.findUnique({ where: { id } });
    if (!script) return reply.code(404).send({ message: "脚本不存在" });
    const conflictCount = await prisma.mergeConflict.count({ where: { scriptId: id, status: "pending" } });
    return { headSeq: script.headSeq, changed: script.headSeq > since, conflictCount };
  });

  /** 提交操作（幂等：重复 opId 回放首次结果） */
  app.post("/scripts/:id/commits", async (req, reply) => {
    const { id } = req.params as { id: string };
    let op;
    try {
      op = parseOperation({ ...(req.body as object), author: actorOf(req) });
    } catch (e) {
      if (e instanceof ZodError) {
        return reply.code(400).send({ message: "操作校验失败", issues: e.issues });
      }
      throw e;
    }
    try {
      const result = await commitOperation(id, op);
      if (result.status === "conflict") {
        return reply.code(409).send({
          message: "产生冲突，已转入待修复",
          conflict: serializeConflict(result.conflict),
        });
      }
      return reply.code(result.duplicate ? 200 : 201).send(result);
    } catch (e) {
      return handleError(e, reply);
    }
  });

  /** 修订历史（变更证据） */
  app.get("/scripts/:id/revisions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const history = await loadHistory(id);
    return history.map((r) => ({
      seq: r.seq,
      opId: r.opId,
      kind: r.kind,
      author: r.author,
      summary: r.summary,
      baseSeq: r.baseSeq,
      rebasedFrom: r.rebasedFrom,
      rebasedOnto: r.rebasedOnto,
      undoable: r.undoable,
      undoneBy: r.undoneBy,
      touched: r.touched,
      createdAt: r.createdAt,
    }));
  });

  /** 撤销预检（前端按钮置灰/提示依据） */
  app.get("/scripts/:id/revisions/:seq/undo-check", async (req, reply) => {
    const { id, seq } = req.params as { id: string; seq: string };
    const actor = actorOf(req);
    try {
      return await previewUndo(id, Number(seq), actor.id);
    } catch (e) {
      return handleError(e, reply);
    }
  });

  /** 撤销：仅本人、不能抹掉他人后续修改 */
  app.post("/scripts/:id/revisions/:seq/undo", async (req, reply) => {
    const { id, seq } = req.params as { id: string; seq: string };
    const actor = actorOf(req);
    try {
      const result = await undoRevision(id, Number(seq), actor);
      return reply.code(201).send(result);
    } catch (e) {
      return handleError(e, reply);
    }
  });

  /** 待修复冲突列表 */
  app.get("/scripts/:id/conflicts", async (req) => listConflicts((req.params as { id: string }).id));

  /** 显式解决冲突 */
  app.post("/scripts/:id/conflicts/:cid/resolve", async (req, reply) => {
    const { id, cid } = req.params as { id: string; cid: string };
    const actor = actorOf(req);
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "解决方式非法", issues: parsed.error.issues });
    }
    try {
      const result = await resolveConflict(id, cid, parsed.data, actor);
      return reply.code(201).send(result);
    } catch (e) {
      return handleError(e, reply);
    }
  });

  /**
   * 显式草稿：保存失败的可见本地草稿可以上云备份，
   * 但状态永远是 draft，绝不与已同步修订混淆。
   */
  app.put("/scripts/:id/drafts", async (req, reply) => {
    const { id } = req.params as { id: string };
    const actor = actorOf(req);
    const body = draftSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "草稿格式非法" });
    const row = await prisma.draft.upsert({
      where: { scriptId_userId: { scriptId: id, userId: actor.id } },
      update: { content: body.data.content as object },
      create: {
        scriptId: id,
        userId: actor.id,
        content: body.data.content as object,
      },
    });
    return reply.code(200).send({ id: row.id, status: "draft", synced: false, updatedAt: row.updatedAt });
  });

  app.get("/scripts/:id/drafts", async (req) => {
    const { id } = req.params as { id: string };
    const actor = actorOf(req);
    const row = await prisma.draft.findUnique({
      where: { scriptId_userId: { scriptId: id, userId: actor.id } },
    });
    return row ? { id: row.id, status: "draft", synced: false, content: row.content, updatedAt: row.updatedAt.toISOString() } : null;
  });
}

const draftSchema = z.object({
  content: z.record(z.unknown()),
});
function serializeConflict(c: unknown) {
  return c;
}

function handleError(e: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) {
  if (e instanceof EngineError) {
    const status =
      e.code === "not_found"
        ? 404
        : e.code === "undo_denied" || e.code === "conflict"
          ? 409
          : e.code === "duplicate"
            ? 200
            : 400;
    logger.warn({ code: e.code, msg: e.message }, "request rejected");
    return reply.code(status).send({ message: e.message, code: e.code });
  }
  if (e instanceof ZodError) {
    return reply.code(400).send({ message: "参数校验失败", issues: e.issues });
  }
  logger.error({ err: e }, "unhandled error");
  return reply.code(500).send({ message: "服务器内部错误" });
}
