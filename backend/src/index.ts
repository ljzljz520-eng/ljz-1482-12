import Fastify from "fastify";
import cors from "@fastify/cors";
import { Pool } from "pg";
import { PgRepository } from "./db/pgRepo.js";
import { InMemoryRepository } from "./domain/memRepo.js";
import { ScriptService, ServiceError } from "./domain/service.js";
import { registerRoutes } from "./api/routes.js";
import { seedIfEmpty } from "./db/seed.js";
import { logger } from "./logger.js";

async function waitForPostgres(pool: Pool, retries = 30): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      logger.warn({ attempt: i + 1 }, "waiting for database...");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("database unavailable after retries");
}

async function main(): Promise<void> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cors, { origin: true });

  const useMemory = process.env.STORAGE === "memory";
  let service: ScriptService;
  if (useMemory) {
    logger.info("using in-memory storage (STORAGE=memory)");
    service = new ScriptService(new InMemoryRepository());
  } else {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    await waitForPostgres(pool);
    service = new ScriptService(new PgRepository(pool));
  }

  await seedIfEmpty(service.repo);
  // 错误处理器必须在注册路由前安装，否则路由内 throw 不会被转换为 JSON
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ServiceError) {
      void reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    logger.error({ err: err.message, path: req.url }, "unhandled error");
    void reply.code(500).send({ error: { code: "INTERNAL", message: "服务异常" } });
  });
  await registerRoutes(app, service);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ host: "0.0.0.0", port });
  logger.info({ port, storage: useMemory ? "memory" : "postgres" }, "script collaboration backend started");
}

main().catch((e) => {
  logger.error({ err: (e as Error).message }, "fatal startup error");
  process.exit(1);
});
