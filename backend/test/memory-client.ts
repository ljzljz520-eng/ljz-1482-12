/**
 * @prisma/client 的内存替身模块（仅测试）。
 * 导出 PrismaClient 与命名空间枚举（$transaction 隔离级别等被服务引用到的常量）。
 */
type Row = Record<string, any>;


function revive<T>(v: T): T {
  return JSON.parse(JSON.stringify(v), (key, val) => {
    if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
      const d = new Date(val);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return val;
  });
}

function matches(row: Row, where: Row): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    // Prisma 复合唯一键 where: { scriptId_userId: { scriptId, userId } }
    if (k.includes("_") && v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !("in" in v)) {
      for (const [nk, nv] of Object.entries(v)) {
        if (row[nk] !== nv) return false;
      }
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      if ("in" in v) {
        if (!(v as any).in.includes(row[k])) return false;
        continue;
      }
    }
    if (row[k] !== v) return false;
  }
  return true;
}

class Delegate {
  rows = new Map<string, Row>();
  uniqueCompound: Record<string, string[]> = {};

  async create(args: { data: Row }) {
    const data = revive(args.data);
    if (!data.id) data.id = `id_${Math.random().toString(36).slice(2)}`;
    if (data.createdAt == null) data.createdAt = new Date();
    if (data.updatedAt == null) data.updatedAt = new Date();
    this.rows.set(data.id, data);
    return revive(data);
  }
  async findUnique(args: { where: Row }) {
    return this.findOne(args.where) ?? null;
  }
  async findUniqueOrThrow(args: { where: Row }) {
    const r = this.findOne(args.where);
    if (!r) throw Object.assign(new Error("record not found"), { code: "P2025" });
    return r;
  }
  async findFirst(args?: { where?: Row }) {
    return this.findAll(args?.where ?? {})[0] ?? null;
  }
  async findMany(args?: { where?: Row; orderBy?: Row }) {
    let out = this.findAll(args?.where ?? {});
    if (args?.orderBy) {
      const [key, dir] = Object.entries(args.orderBy)[0];
      out = out.sort((a, b) => {
        const av = a[key]; const bv = b[key];
        if (av instanceof Date && bv instanceof Date) return (av.getTime() - bv.getTime()) * (dir === "desc" ? -1 : 1);
        return (av > bv ? 1 : av < bv ? -1 : 0) * (dir === "desc" ? -1 : 1);
      });
    }
    return revive(out);
  }
  async update(args: { where: Row; data: Row }) {
    const target = this.findRaw(args.where);
    if (!target) throw Object.assign(new Error("record not found"), { code: "P2025" });
    const incoming = revive(args.data);
    if (incoming.updatedAt == null) incoming.updatedAt = new Date();
    Object.assign(target, incoming);
    return JSON.parse(JSON.stringify(target));
  }
  async upsert(args: { where: Row; update: Row; create: Row }) {

    const existing = this.findRaw(args.where);
    if (existing) {
      Object.assign(existing, revive(args.update));
      return revive(existing);
    }
    // where 中的简单键（如 opId）与复合键都要并入 create
    const simple = Object.fromEntries(
      Object.entries(args.where).filter(([, v]) => !(v && typeof v === "object")),
    );
    const compound = Object.entries(args.where)
      .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date))
      .reduce((acc, [, v]) => ({ ...acc, ...(v as Row) }), {});
    const created = await this.create({ data: { ...simple, ...compound, ...args.create } as Row });
    return created;
  }
  async count(args?: { where?: Row }) {
    return this.findAll(args?.where ?? {}).length;
  }

  private findAll(where: Row): Row[] {
    return [...this.rows.values()].filter((r) => matches(r, where));
  }
  private findRaw(where: Row): Row | undefined {
    return this.findAll(where)[0];
  }
  private findOne(where: Row): Row | null {
    const raw = this.findRaw(where);
    return raw ? revive(raw) : null;
  }
}

class PrismaClient {
  script = new Delegate();
  revision = new Delegate();
  sceneNode = new Delegate();
  element = new Delegate();
  character = new Delegate();
  subtitleAnchor = new Delegate();
  mediaRange = new Delegate();
  mergeConflict = new Delegate();
  draft = new Delegate();

  // 内存替身里事务即直接执行（测试串行执行，无真实并发交叉）
  async $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async $disconnect() {}
}

export const Prisma = {
  TransactionIsolationLevel: {
    Serializable: "Serializable",
    ReadCommitted: "ReadCommitted",
  },
  InputJsonValue: class {},
};

export default { PrismaClient, Prisma };


// 单例：setup 注入与 lib/prisma.ts 实例化必须拿到同一个内存库
let singleton: unknown = null;
export function createMemoryClient() {
  if (!singleton) singleton = new PrismaClient();
  return singleton as unknown as import("@prisma/client").PrismaClient;
}
