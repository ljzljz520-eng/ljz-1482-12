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
} from "./types.js";

/**
 * 仓储端口（ports & adapters）：
 * 生产环境由 PostgreSQL + Drizzle 实现；测试环境由内存仓储实现。
 * 引擎只依赖该接口，因此协作语义不依赖具体数据库。
 */
export interface ScriptRepository {
  listScripts(): Promise<Array<{ id: string; title: string; headRev: number; updatedAt: string }>>;
  getDoc(scriptId: string): Promise<Doc | null>;
  /** 在一个串行化事务内：查重 opId、追加修订、以新快照替换当前实体集合、推进 headRev。 */
  commit(
    scriptId: string,
    input: {
      opId: string;
      author: string;
      type: string;
      baseRev: number;
      payload: Record<string, unknown>;
      result: import("./types.js").ApplyResult;
      next: Omit<Doc, "id" | "title" | "headRev">;
    },
  ): Promise<{ seq: number; duplicated?: CommittedRevision }>;
  revisions(scriptId: string): Promise<CommittedRevision[]>;
  createScript(input: {
    id: string;
    title: string;
    entities: Omit<Doc, "id" | "title" | "headRev">;
  }): Promise<void>;
}

export type EntityTables = {
  characters: Character[];
  scenes: Scene[];
  lines: Line[];
  shots: Shot[];
  materials: Material[];
  anchors: Anchor[];
  conflicts: Conflict[];
};
