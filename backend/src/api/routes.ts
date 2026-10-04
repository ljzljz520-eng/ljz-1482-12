import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { nanoid } from "nanoid";
import { ScriptService, ServiceError } from "../domain/service.js";
import { summarize } from "../domain/engine.js";
import { logger } from "../logger.js";
import type { Doc, Operation, OpType } from "../domain/types.js";

const opSchema = z.object({
  opId: z.string().min(1).max(128),
  author: z.string().min(1).max(64),
  type: z.enum([
    "edit.field",
    "scene.split",
    "scene.merge",
    "scene.delete",
    "scene.move",
    "repair.resolve",
    "conflict.resolve",
    "undo",
  ]) as z.ZodType<OpType>,
  baseRev: z.number().int().min(0),
  payload: z.record(z.string(), z.unknown()),
});

function buildPreview(doc: Doc) {
  const summary = summarize(doc);
  const durationOf = new Map(summary.scenes.map((x) => [x.id, x.durationMs]));
  const scenes = doc.scenes
    .filter((s) => !s.deleted)
    .sort((a, b) => a.index - b.index)
    .map((s) => ({
      id: s.id,
      no: s.index + 1,
      sceneDurationMs: durationOf.get(s.id) ?? 0,
      heading: s.heading,
      narration: s.narration,
      status: s.status,
      lines: doc.lines
        .filter((l) => l.sceneId === s.id)
        .sort((a, b) => a.order - b.order)
        .map((l) => ({
          id: l.id,
          characterId: l.characterId,
          characterName: doc.characters.find((c) => c.id === l.characterId)?.name ?? null,
          text: l.text,
          needsRepair: l.needsRepair,
          repairReason: l.repairReason,
        })),
      shots: doc.shots
        .filter((x) => x.sceneId === s.id)
        .sort((a, b) => a.order - b.order)
        .map((x) => ({
          id: x.id,
          label: x.label,
          description: x.description,
          durationMs: x.durationMs,
          needsRepair: x.needsRepair,
          repairReason: x.repairReason,
        })),
      materials: doc.materials
        .filter((m) => m.sceneId === s.id)
        .map((m) => ({ id: m.id, kind: m.kind, name: m.name, startMs: m.startMs, endMs: m.endMs, needsRepair: m.needsRepair, repairReason: m.repairReason })),
      anchors: doc.anchors
        .filter((a) => a.sceneId === s.id)
        .map((a) => ({ id: a.id, refType: a.refType, refId: a.refId, timeMs: a.timeMs, needsRepair: a.needsRepair, repairReason: a.repairReason })),
    }));
  return {
    scriptId: doc.id,
    title: doc.title,
    rev: doc.headRev,
    summary: summarize(doc),
    characters: doc.characters,
    conflicts: doc.conflicts,
    scenes,
  };
}

export async function registerRoutes(app: FastifyInstance, service: ScriptService): Promise<void> {
  app.get("/health", async () => ({ ok: true, ts: Date.now() }));

  app.get("/scripts", async () => ({ scripts: await service.listScripts() }));

  app.get("/scripts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = await service.getDoc(id);
    if (!doc) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "脚本不存在" } });
    return {
      scriptId: doc.id,
      title: doc.title,
      rev: doc.headRev,
      characters: doc.characters,
      conflicts: doc.conflicts,
      scenes: doc.scenes,
      lines: doc.lines,
      shots: doc.shots,
      materials: doc.materials,
      anchors: doc.anchors,
      summary: summarize(doc),
    };
  });

  /**
   * 预览。snapshotAt + delayMs 仅用于验收"旧响应晚到"：
   * 在等待前捕获修订号，响应体携带该修订，客户端据此丢弃晚到的旧预览。
   */
  app.get("/scripts/:id/preview", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { snapshotAt?: string; delayMs?: string };
    const doc = await service.getDoc(id);
    if (!doc) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "脚本不存在" } });
    const snapshotRev = doc.headRev;
    const delay = Math.min(Number(q.delayMs ?? 0) || 0, 8000);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const preview = buildPreview(doc);
    return { ...preview, rev: snapshotRev, stale: q.snapshotAt !== undefined };
  });

  app.get("/scripts/:id/revisions", async (req) => {
    const { id } = req.params as { id: string };
    return { revisions: await service.revisions(id) };
  });

  app.post("/scripts/:id/ops", async (req, reply) => {
    const { id } = req.params as { id: string };
    let op: Operation;
    try {
      const parsed = opSchema.parse(req.body ?? {});
      op = { ...parsed, payload: parsed.payload as Record<string, unknown> };
    } catch (e) {
      if (e instanceof ZodError) {
        logger.warn({ issues: e.issues }, "invalid operation payload");
        return reply.code(400).send({ error: { code: "VALIDATION", issues: e.issues } });
      }
      throw e;
    }
    try {
      const out = await service.commit(id, op);
      const doc = await service.getDoc(id);
      return reply.code(200).send({
        ...out,
        summary: doc ? summarize(doc) : null,
        openConflict: out.result.status === "conflict" ? out.result.conflictId : null,
      });
    } catch (e) {
      if (e instanceof ServiceError) return reply.code(e.statusCode).send({ error: { code: e.code, message: e.message } });
      logger.error({ err: (e as Error).message }, "commit failed");
      return reply.code(500).send({ error: { code: "INTERNAL", message: "服务端处理失败，本地草稿仍保留" } });
    }
  });

  app.post("/scripts", async (req, reply) => {
    const body = z.object({ title: z.string().min(1).max(120) }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "VALIDATION", issues: body.error.issues } });
    const id = `script_${nanoid(8)}`;
    const { createBlankScript } = await import("../db/blank.js");
    await createBlankScript(service.repo, id, body.data.title);
    return reply.code(201).send({ id, title: body.data.title });
  });

}
