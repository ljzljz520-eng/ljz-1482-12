import { randomUUID } from "node:crypto";
import type { ApplyResult, Doc, Operation } from "./types.js";
import { applyOp } from "./engine.js";
import type { ScriptRepository } from "./repository.js";

export interface CommitResponse {
  rev: number;
  opId: string;
  result: ApplyResult;
  rebased: boolean;
  /** 断线重连重复提交时，直接返回已落库的那次结果（幂等） */
  duplicate: boolean;
}

/**
 * 协作策略选型（见 README 详述）：修订日志 + 乐观并发 + 结构操作显式合并。
 *  - 操作变换(OT)：需要全局变换算子，对"拆分/合并"这类结构操作的变换不封闭，放弃；
 *  - CRDT：身份合并天然支持，但"场次删除 vs 拆分"在业务上没有纯函数解，需要显式裁决层；
 *  - 本实现：服务端为唯一序列化点（每脚本一把咨询锁/互斥锁），
 *    内容编辑在最新修订上重放(rebase)，结构冲突提升为显式 Conflict 由用户裁决，禁止无声丢内容。
 */
export class ScriptService {
  /** 单进程内按 scriptId 串行化；PostgreSQL 实现额外使用事务 + 行锁保证多实例正确。 */
  private locks = new Map<string, Promise<unknown>>();

  constructor(readonly repo: ScriptRepository) {}

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    this.locks.set(key, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }

  async listScripts() {
    return this.repo.listScripts();
  }

  async getDoc(scriptId: string): Promise<Doc | null> {
    return this.repo.getDoc(scriptId);
  }

  async revisions(scriptId: string) {
    return this.repo.revisions(scriptId);
  }

  async commit(scriptId: string, op: Operation): Promise<CommitResponse> {
    if (!op.opId) throw new Error("opId 必填（幂等键）");
    if (!op.author) throw new Error("author 必填");
    return this.withLock(scriptId, async () => {
      const doc = await this.repo.getDoc(scriptId);
      if (!doc) throw new ServiceError("SCRIPT_NOT_FOUND", "脚本不存在", 404);

      const history = await this.repo.revisions(scriptId);
      const dup = history.find((r) => r.opId === op.opId);
      if (dup) {
        // 断线重复提交：第一次的结果即最终结果
        return {
          rev: dup.seq,
          opId: op.opId,
          result: dup.result,
          rebased: dup.baseRev !== op.baseRev,
          duplicate: true,
        };
      }

      // 显式 rebase：baseRev 落后时不拒绝整个操作，而是在最新修订上重放，
      // 但在响应中明确告知"已变基"，由前端提示用户核对。
      const rebased = op.baseRev !== doc.headRev;
      const effective: Operation =
        op.type === "undo"
          ? { ...op, payload: { ...op.payload, __history: history } }
          : op;

      const { result, next } = applyOp(doc, effective);
      if (result.status === "accepted" && rebased) result.rebased = true;

      const { seq } = await this.repo.commit(scriptId, {
        opId: op.opId,
        author: op.author,
        type: op.type,
        baseRev: op.baseRev,
        payload: stripHistory(effective.payload),
        result,
        next,
      });

      return { rev: seq, opId: op.opId, result, rebased, duplicate: false };
    });
  }
}

function stripHistory(payload: Record<string, unknown>): Record<string, unknown> {
  const { __history, ...rest } = payload as Record<string, unknown>;
  void __history;
  return rest;
}

export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export function newOpId(): string {
  return randomUUID();
}
