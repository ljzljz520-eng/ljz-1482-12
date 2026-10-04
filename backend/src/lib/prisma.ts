import { PrismaClient } from "@prisma/client";

/**
 * 测试环境（PRISMA_MEMORY=1）使用内存替身，保证无 PostgreSQL 也能跑端到端测试；
 * 生产/容器内始终使用真实 @prisma/client + Postgres。
 */
function createClient(): PrismaClient {
  if (process.env.PRISMA_MEMORY === "1") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = (globalThis as { __MEMORY_PRISMA__?: { prisma: PrismaClient } }).__MEMORY_PRISMA__;
    if (mod) return mod.prisma;
    throw new Error("内存 Prisma 未安装：测试引导须先设置 globalThis.__MEMORY_PRISMA__");
  }
  return new PrismaClient({
    log: [
      { level: "warn", emit: "stdout" },
      { level: "error", emit: "stdout" },
    ],
  });
}

export const prisma = createClient();
