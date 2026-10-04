import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * 当前文档采用"规范化实体表 + 只追加修订日志"双份存储：
 *  - 实体表是引擎 apply 之后的权威当前状态（供查询/预览，无历史下标含义）；
 *  - revisions 是不可变的操作与结果证据（证据链，永不更新/删除）。
 * 所有跨表引用一律使用稳定身份 id，绝不引用数组下标。
 */

export const scripts = pgTable("scripts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  headRev: integer("head_rev").notNull().default(0),
  /** 建档时的初始实体快照，用于按修订号重放历史预览（旧响应晚到验收） */
  seed: jsonb("seed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const revisions = pgTable(
  "revisions",
  {
    id: text("id").primaryKey(),
    scriptId: text("script_id")
      .notNull()
      .references(() => scripts.id),
    seq: integer("seq").notNull(),
    opId: text("op_id").notNull(),
    author: text("author").notNull(),
    type: text("type").notNull(),
    baseRev: integer("base_rev").notNull(),
    payload: jsonb("payload").notNull(),
    /** apply 结果：accepted / blocked / conflict，及拒绝原因与冲突 id，作为变更证据 */
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqOp: uniqueIndex("revisions_script_op_uq").on(t.scriptId, t.opId),
    uniqSeq: uniqueIndex("revisions_script_seq_uq").on(t.scriptId, t.seq),
  }),
);

export const characters = pgTable("characters", {
  id: text("id").primaryKey(),
  scriptId: text("script_id")
    .notNull()
    .references(() => scripts.id),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  archived: boolean("archived").notNull().default(false),
});

export const scenes = pgTable("scenes", {
  id: text("id").primaryKey(),
  scriptId: text("script_id")
    .notNull()
    .references(() => scripts.id),
  index: integer("index").notNull(),
  heading: text("heading").notNull(),
  narration: text("narration").notNull().default(""),
  status: text("status").notNull().default("active"), // active | pending_repair | pending_orphan | deleted
  origin: text("origin").notNull().default("seed"), // seed | split | merge
  parentSceneId: text("parent_scene_id"),
  deleted: boolean("deleted").notNull().default(false),
  createdInRev: integer("created_in_rev").notNull().default(0),
  createdBy: text("created_by").notNull().default(""),
  updatedInRev: integer("updated_in_rev").notNull().default(0),
  updatedBy: text("updated_by").notNull().default(""),
});

export const lines = pgTable("lines", {
  id: text("id").primaryKey(),
  scriptId: text("script_id")
    .notNull()
    .references(() => scripts.id),
  sceneId: text("scene_id")
    .notNull()
    .references(() => scenes.id),
  order: integer("order").notNull(),
  characterId: text("character_id"),
  text: text("text").notNull().default(""),
  needsRepair: boolean("needs_repair").notNull().default(false),
  repairReason: text("repair_reason"),
  createdInRev: integer("created_in_rev").notNull().default(0),
  createdBy: text("created_by").notNull().default(""),
  updatedInRev: integer("updated_in_rev").notNull().default(0),
  updatedBy: text("updated_by").notNull().default(""),
});

export const shots = pgTable("shots", {
  id: text("id").primaryKey(),
  scriptId: text("script_id")
    .notNull()
    .references(() => scripts.id),
  sceneId: text("scene_id")
    .notNull()
    .references(() => scenes.id),
  order: integer("order").notNull(),
  label: text("label").notNull().default(""),
  description: text("description").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  needsRepair: boolean("needs_repair").notNull().default(false),
  repairReason: text("repair_reason"),
  createdInRev: integer("created_in_rev").notNull().default(0),
  createdBy: text("created_by").notNull().default(""),
  updatedInRev: integer("updated_in_rev").notNull().default(0),
  updatedBy: text("updated_by").notNull().default(""),
});

export const materials = pgTable("materials", {
  id: text("id").primaryKey(),
  scriptId: text("script_id")
    .notNull()
    .references(() => scripts.id),
  sceneId: text("scene_id")
    .notNull()
    .references(() => scenes.id),
  kind: text("kind").notNull(), // video | audio | image
  name: text("name").notNull(),
  startMs: integer("start_ms").notNull().default(0),
  endMs: integer("end_ms").notNull().default(0),
  needsRepair: boolean("needs_repair").notNull().default(false),
  repairReason: text("repair_reason"),
  createdInRev: integer("created_in_rev").notNull().default(0),
  createdBy: text("created_by").notNull().default(""),
  updatedInRev: integer("updated_in_rev").notNull().default(0),
  updatedBy: text("updated_by").notNull().default(""),
});

export const anchors = pgTable("anchors", {
  id: text("id").primaryKey(),
  scriptId: text("script_id")
    .notNull()
    .references(() => scripts.id),
  sceneId: text("scene_id")
    .notNull()
    .references(() => scenes.id),
  refType: text("ref_type").notNull(), // line | shot
  refId: text("ref_id").notNull(),
  timeMs: integer("time_ms").notNull().default(0),
  needsRepair: boolean("needs_repair").notNull().default(false),
  repairReason: text("repair_reason"),
  createdInRev: integer("created_in_rev").notNull().default(0),
  createdBy: text("created_by").notNull().default(""),
  updatedInRev: integer("updated_in_rev").notNull().default(0),
  updatedBy: text("updated_by").notNull().default(""),
});

/** 显式结构冲突：所有结果都必须能被用户看到并手工裁决，绝不静默丢弃内容 */
export const conflicts = pgTable("conflicts", {
  id: text("id").primaryKey(),
  scriptId: text("script_id")
    .notNull()
    .references(() => scripts.id),
  kind: text("kind").notNull(), // split_deleted_parent | delete_has_children | ...
  status: text("status").notNull().default("open"), // open | resolved

  sceneId: text("scene_id"),
  detail: jsonb("detail").notNull(),
  raisedBy: text("raised_by").notNull(),
  raisedInRev: integer("raised_in_rev").notNull(),
  resolvedBy: text("resolved_by"),
  resolvedInRev: integer("resolved_in_rev"),
  resolution: text("resolution"), // keep_split | keep_delete | restore_merge_parents
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
