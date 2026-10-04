import Fastify from "fastify";
import cors from "@fastify/cors";
import { logger } from "./lib/logger.js";
import { scriptRoutes } from "./routes/script.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
        : undefined,
  },
  bodyLimit: 2 * 1024 * 1024,
});

await app.register(cors, { origin: true });

app.get("/", async () => ({ service: "script-collab-backend", status: "ok" }));
await app.register(scriptRoutes, { prefix: "/api" });

app.setErrorHandler((err, _req, reply) => {
  app.log.error({ err: err.message, stack: err.stack }, "unhandled exception");
  reply.code(500).send({ message: "服务器内部错误" });
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  logger.info(`🎬 协同脚本拆场服务已启动: http://${host}:${port}/api`);
} catch (err) {
  logger.error({ err }, "启动失败");
  process.exit(1);
}

process.on("SIGTERM", async () => {
  logger.info("收到 SIGTERM，关闭服务…");
  await app.close();
  process.exit(0);
});
