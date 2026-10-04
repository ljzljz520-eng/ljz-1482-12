import { createMemoryClient } from "./memory-client.js";

(globalThis as Record<string, unknown>).__MEMORY_PRISMA__ = { prisma: createMemoryClient() };
process.env.PRISMA_MEMORY = "1";
