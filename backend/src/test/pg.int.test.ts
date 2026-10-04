import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PgRepository } from "../db/pgRepo.js";
import { ScriptService } from "../domain/service.js";
import { seedIfEmpty } from "../db/seed.js";

const RUN = process.env.RUN_PG_TEST === "1";
const maybe = RUN ? describe : describe.skip;

maybe("PgRepository（真实 PostgreSQL）", () => {
  let pool: Pool;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const pg = new EmbeddedPostgres({
      databaseDir: join(process.cwd(), ".pg-test"),
      user: "test",
      password: "test",
      port: 54399,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("test");
    stop = () => pg.stop();
    pool = new Pool({ connectionString: "postgres://test:test@localhost:54399/test", max: 5 });

    const dir = join(process.cwd(), "drizzle");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      await pool.query(readFileSync(join(dir, f), "utf8"));
    }
  }, 120000);

  afterAll(async () => {
    await pool?.end();
    await stop?.();
  });

  it("种子/提交/幂等/冲突在真实数据库上端到端工作", async () => {
    const repo = new PgRepository(pool);
    await seedIfEmpty(repo);
    const service = new ScriptService(repo);

    const split = await service.commit("demo-script", {
      opId: "int-1",
      author: "甲",
      type: "scene.split",
      baseRev: 0,
      payload: { sceneId: "sc_02", cutMs: 7000, lineSide: { ln_03: "head", ln_04: "tail" } },
    });
    expect(split.result.status).toBe("accepted");
    expect(split.rev).toBe(1);

    const dup = await service.commit("demo-script", {
      opId: "int-1",
      author: "甲",
      type: "scene.split",
      baseRev: 0,
      payload: {},
    });
    expect(dup.duplicate).toBe(true);
    expect(dup.rev).toBe(1);

    const del = await service.commit("demo-script", {
      opId: "int-2",
      author: "乙",
      type: "scene.delete",
      baseRev: 1,
      payload: { sceneId: "sc_02" },
    });
    expect(del.result.status).toBe("conflict");

    const doc = await repo.getDoc("demo-script");
    expect(doc).toBeTruthy();
    expect(doc!.headRev).toBe(2);
    expect(doc!.conflicts.some((c) => c.kind === "delete_has_children")).toBe(true);
    expect(doc!.lines.find((l) => l.id === "ln_04")!.sceneId).not.toBe("sc_02");

    const revs = await repo.revisions("demo-script");
    expect(revs[0].payload).toMatchObject({ cutMs: 7000 });
  }, 60000);
});
