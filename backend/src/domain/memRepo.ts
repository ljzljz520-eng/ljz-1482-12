import { nanoid } from "nanoid";
import type { CommittedRevision, Doc } from "./types.js";
import type { ScriptRepository } from "./repository.js";

/** 内存仓储：与 PgRepository 行为等价（含 (scriptId,opId) 幂等键），用于引擎测试。 */
export class InMemoryRepository implements ScriptRepository {
  private docs = new Map<string, Doc>();
  private revs = new Map<string, CommittedRevision[]>();
  private meta = new Map<string, { updatedAt: string }>();

  async listScripts() {
    return [...this.docs.entries()].map(([id, d]) => ({
      id,
      title: d.title,
      headRev: d.headRev,
      updatedAt: this.meta.get(id)!.updatedAt,
    }));
  }

  async getDoc(scriptId: string): Promise<Doc | null> {
    const d = this.docs.get(scriptId);
    return d ? (structuredClone(d) as Doc) : null;
  }

  async revisions(scriptId: string) {
    return structuredClone(this.revs.get(scriptId) ?? []) as CommittedRevision[];
  }

  async createScript(input: {
    id: string;
    title: string;
    entities: Omit<Doc, "id" | "title" | "headRev">;
  }) {
    this.docs.set(input.id, {
      id: input.id,
      title: input.title,
      headRev: 0,
      ...structuredClone(input.entities),
    });
    this.revs.set(input.id, []);
    this.meta.set(input.id, { updatedAt: new Date().toISOString() });
  }

  async commit(
    scriptId: string,
    input: {
      opId: string;
      author: string;
      type: string;
      baseRev: number;
      payload: Record<string, unknown>;
      result: import("./types.js").ApplyResult;
      next: Omit<Doc, "id" | "title">;
    },
  ): Promise<{ seq: number; duplicated?: CommittedRevision }> {
    const list = this.revs.get(scriptId)!;
    const dup = list.find((r) => r.opId === input.opId);
    if (dup) return { seq: dup.seq, duplicated: structuredClone(dup) };

    const seq = list.length + 1;
    const rev: CommittedRevision = {
      seq,
      opId: input.opId,
      author: input.author,
      type: input.type as CommittedRevision["type"],
      baseRev: input.baseRev,
      payload: structuredClone(input.payload),
      result: structuredClone(input.result),
      createdAt: new Date().toISOString(),
    };
    list.push(rev);

    const doc = this.docs.get(scriptId)!;
    // 即使 blocked/conflict 也推进修订头：修订号是日志位置而非"成功版本号"
    doc.headRev = seq;
    doc.characters = structuredClone(input.next.characters);
    doc.scenes = structuredClone(input.next.scenes);
    doc.lines = structuredClone(input.next.lines);
    doc.shots = structuredClone(input.next.shots);
    doc.materials = structuredClone(input.next.materials);
    doc.anchors = structuredClone(input.next.anchors);
    doc.conflicts = structuredClone(input.next.conflicts);
    this.meta.set(scriptId, { updatedAt: new Date().toISOString() });
    return { seq };
  }
}

export function rid(size = 12): string {
  return nanoid(size);
}
