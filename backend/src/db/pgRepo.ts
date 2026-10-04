import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  anchors,
  characters,
  conflicts,
  lines,
  materials,
  revisions,
  scenes,
  scripts,
  shots,
} from "./schema.js";
import { and, asc, eq, sql } from "drizzle-orm";
import type {
  Anchor,
  Character,
  CommittedRevision,
  Conflict,
  Doc,
  Line,
  Material,
  Scene,
  Shot,
} from "../domain/types.js";
import type { ScriptRepository } from "../domain/repository.js";
import { logger } from "../logger.js";

type Entities = Omit<Doc, "id" | "title" | "headRev">;

export class PgRepository implements ScriptRepository {
  private db: NodePgDatabase<Record<string, never>>;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async listScripts() {
    const rows = await this.db.select().from(scripts).orderBy(scripts.updatedAt);
    return rows.map((r) => ({ id: r.id, title: r.title, headRev: r.headRev, updatedAt: r.updatedAt.toISOString() }));
  }

  async createScript(input: { id: string; title: string; entities: Entities }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(scripts).values({
        id: input.id,
        title: input.title,
        headRev: 0,
        seed: input.entities,
      });
      await this.replaceEntities(tx, input.id, input.entities);
    });
  }

  private async replaceEntities(tx: any, scriptId: string, e: Entities): Promise<void> {
    // 当前态 = 引擎产出的完整快照。引用全部基于稳定 id，删除=deleted 标记，因此可以整体替换。
    await tx.delete(conflicts).where(eq(conflicts.scriptId, scriptId));
    await tx.delete(anchors).where(eq(anchors.scriptId, scriptId));
    await tx.delete(materials).where(eq(materials.scriptId, scriptId));
    await tx.delete(lines).where(eq(lines.scriptId, scriptId));
    await tx.delete(shots).where(eq(shots.scriptId, scriptId));
    await tx.delete(scenes).where(eq(scenes.scriptId, scriptId));
    await tx.delete(characters).where(eq(characters.scriptId, scriptId));

    if (e.characters.length)
      await tx.insert(characters).values(e.characters.map((c: Character) => ({ ...c, archived: c.archived ?? false, scriptId })));
    if (e.scenes.length)
      await tx.insert(scenes).values(
        e.scenes.map((s: Scene) => ({
          ...s,
          scriptId,
          parentSceneId: s.parentSceneId ?? null,
        })),
      );
    if (e.lines.length)
      await tx.insert(lines).values(
        e.lines.map((l: Line) => ({ ...l, scriptId, characterId: l.characterId ?? null, repairReason: l.repairReason ?? null })),
      );
    if (e.shots.length)
      await tx.insert(shots).values(e.shots.map((s: Shot) => ({ ...s, scriptId, repairReason: s.repairReason ?? null })));
    if (e.materials.length)
      await tx.insert(materials).values(e.materials.map((m: Material) => ({ ...m, scriptId, repairReason: m.repairReason ?? null })));
    if (e.anchors.length)
      await tx.insert(anchors).values(e.anchors.map((a: Anchor) => ({ ...a, scriptId, repairReason: a.repairReason ?? null })));

    // 冲突是文档当前状态的一部分，随快照整体替换；完整裁决证据同时保存在 revisions 日志（永不删除）。
    if (e.conflicts.length) {
      await tx.insert(conflicts).values(
        e.conflicts.map((c: Conflict) => ({
          id: c.id,
          scriptId,
          kind: c.kind,
          status: c.status,
          sceneId: c.sceneId ?? null,
          detail: c.detail,
          raisedBy: c.raisedBy,
          raisedInRev: c.raisedInRev,
          resolvedBy: c.resolvedBy ?? null,
          resolvedInRev: c.resolvedInRev ?? null,
          resolution: c.resolution ?? null,
        })),
      );
    }
  }

  async getDoc(scriptId: string): Promise<Doc | null> {
    const head = await this.db.select().from(scripts).where(eq(scripts.id, scriptId)).limit(1);
    if (head.length === 0) return null;
    const [s] = head;
    const [cs, sc, ls, sh, ms, an, cf] = await Promise.all([
      this.db.select().from(characters).where(eq(characters.scriptId, scriptId)),
      this.db.select().from(scenes).where(eq(scenes.scriptId, scriptId)),
      this.db.select().from(lines).where(eq(lines.scriptId, scriptId)),
      this.db.select().from(shots).where(eq(shots.scriptId, scriptId)),
      this.db.select().from(materials).where(eq(materials.scriptId, scriptId)),
      this.db.select().from(anchors).where(eq(anchors.scriptId, scriptId)),
      this.db
        .select()
        .from(conflicts)
        .where(eq(conflicts.scriptId, scriptId))
        .orderBy(asc(conflicts.createdAt)),
    ]);
    return {
      id: s.id,
      title: s.title,
      headRev: s.headRev,
      characters: cs.map((r) => ({ ...r, archived: r.archived ?? false })) as Character[],
      scenes: sc.map((r) => ({ ...r, parentSceneId: r.parentSceneId ?? null })) as Scene[],
      lines: ls.map((r) => ({ ...r, characterId: r.characterId ?? null, repairReason: r.repairReason ?? null })) as Line[],
      shots: sh.map((r) => ({ ...r, repairReason: r.repairReason ?? null })) as Shot[],
      materials: ms.map((r) => ({ ...r, repairReason: r.repairReason ?? null })) as Material[],
      anchors: an.map((r) => ({ ...r, repairReason: r.repairReason ?? null })) as Anchor[],
      conflicts: cf.map((r) => ({
        ...r,
        sceneId: r.sceneId ?? null,
        resolvedBy: r.resolvedBy ?? null,
        resolvedInRev: r.resolvedInRev ?? null,
        resolution: r.resolution ?? null,
        createdAt: r.createdAt.toISOString(),
        detail: typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail,
      })) as Conflict[],
    };
  }

  async revisions(scriptId: string): Promise<CommittedRevision[]> {
    const rows = await this.db
      .select()
      .from(revisions)
      .where(eq(revisions.scriptId, scriptId))
      .orderBy(asc(revisions.seq));
    return rows.map((r) => ({
      seq: r.seq,
      opId: r.opId,
      author: r.author,
      type: r.type as CommittedRevision["type"],
      baseRev: r.baseRev,
      payload: r.payload as Record<string, unknown>,
      result: r.result as CommittedRevision["result"],
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async commit(
    scriptId: string,
    input: {
      opId: string;
      author: string;
      type: string;
      baseRev: number;
      payload: Record<string, unknown>;
      result: import("../domain/types.js").ApplyResult;
      next: Entities;
    },
  ): Promise<{ seq: number; duplicated?: CommittedRevision }> {
    return this.db.transaction(async (tx) => {
      // SELECT ... FOR UPDATE 锁定脚本行，保证并发提交在数据库层串行化
      await tx.select({ id: scripts.id }).from(scripts).where(eq(scripts.id, scriptId)).for("update");

      const dupRows = await tx
        .select()
        .from(revisions)
        .where(and(eq(revisions.scriptId, scriptId), eq(revisions.opId, input.opId)))
        .limit(1);
      if (dupRows.length === 1) {
        const r = dupRows[0];
        return {
          seq: r.seq,
          duplicated: {
            seq: r.seq,
            opId: r.opId,
            author: r.author,
            type: r.type as CommittedRevision["type"],
            baseRev: r.baseRev,
            payload: r.payload as Record<string, unknown>,
            result: r.result as CommittedRevision["result"],
            createdAt: r.createdAt.toISOString(),
          },
        };
      }

      // 修订号是只追加日志的位置：accepted/blocked/conflict 都占号（证据完整），
      // 因此 headRev 始终等于 revisions 条数，baseRev 比较与按号撤销才不会错位。
      const countRows = await tx.execute<{ count: string }>(sql`SELECT count(*)::int AS count FROM ${revisions} WHERE ${revisions.scriptId} = ${scriptId}`);
      const seq = Number(countRows.rows[0].count) + 1;

      await tx.insert(revisions).values({
        id: `${scriptId.slice(0, 8)}-${seq}-${input.opId.slice(0, 8)}`,
        scriptId,
        seq,
        opId: input.opId,
        author: input.author,
        type: input.type,
        baseRev: input.baseRev,
        payload: input.payload,
        result: input.result,
      });
      await tx
        .update(scripts)
        .set({ headRev: seq, updatedAt: new Date() })
        .where(eq(scripts.id, scriptId));

      await this.replaceEntities(tx as any, scriptId, input.next);
      logger.info({ scriptId, seq, type: input.type, author: input.author, status: input.result.status }, "revision committed");
      return { seq };
    });
  }
}
