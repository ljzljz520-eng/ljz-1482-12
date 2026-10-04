import { z } from "zod";
import type { Operation, OpBody } from "../domain/types.js";

const actorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const editElementBody = z.object({
  type: z.literal("editElement"),
  elementId: z.string().min(1),
  fields: z.object({
    content: z.string().optional(),
    roleId: z.string().nullable().optional(),
    durationSec: z.number().min(0).optional(),
  }),
  expected: z.record(z.unknown()).optional(),
});

const setDurationBody = z.object({
  type: z.literal("setDuration"),
  elementId: z.string().min(1),
  durationSec: z.number().min(0).max(60 * 60 * 12),
  expectedDurationSec: z.number().optional(),
});

const renameSceneBody = z.object({
  type: z.literal("renameScene"),
  sceneId: z.string().min(1),
  title: z.string().trim().min(1, "场次名不能为空").max(120),
  expectedTitle: z.string().optional(),
});

const elementSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().min(1),
  originSceneId: z.string().nullable().optional(),
  kind: z.enum(["narration", "dialogue", "shot"]),
  roleId: z.string().nullable().optional(),
  content: z.string(),
  durationSec: z.number().min(0),
  orderIdx: z.number(),
  needsReview: z.boolean().optional(),
  reviewReason: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

const addElementBody = z.object({
  type: z.literal("addElement"),
  element: elementSchema,
});

const deleteElementBody = z.object({
  type: z.literal("deleteElement"),
  elementId: z.string().min(1),
});

const reattachBody = z.object({
  type: z.literal("reattachElement"),
  elementId: z.string().min(1),
  sceneId: z.string().min(1),
  orderIdx: z.number().optional(),
});

const splitBody = z.object({
  type: z.literal("splitScene"),
  sceneId: z.string().min(1),
  newSceneId: z.string().min(1),
  newTitle: z.string().trim().min(1).max(120),
  splitAtMs: z.number().min(0).nullable().optional(),
  afterElementIds: z.array(z.string().min(1)).min(1, "至少选择一个拆出节点"),
});

const mergeBody = z.object({
  type: z.literal("mergeScenes"),
  sceneIdA: z.string().min(1),
  sceneIdB: z.string().min(1),
  mergedTitle: z.string().trim().min(1).max(120),
});

const deleteSceneBody = z.object({
  type: z.literal("deleteScene"),
  sceneId: z.string().min(1),
  reason: z.string().max(200).optional(),
});

const restoreBody = z.object({
  type: z.literal("restoreState"),
  reason: z.string().min(1),
  scenes: z.array(z.any()).optional(),
  elements: z.array(z.any()).optional(),
  anchors: z.array(z.any()).optional(),
  ranges: z.array(z.any()).optional(),
  touched: z
    .array(z.object({ kind: z.enum(["scene", "element", "character"]), id: z.string() }))
    .optional(),
});

const bodySchema = z.discriminatedUnion("type", [
  editElementBody,
  setDurationBody,
  renameSceneBody,
  addElementBody,
  deleteElementBody,
  reattachBody,
  splitBody,
  mergeBody,
  deleteSceneBody,
  restoreBody,
]);

export const operationSchema = z
  .object({
    opId: z.string().min(1).max(120),
    baseSeq: z.number().int().min(0),
    author: actorSchema,
    createdAt: z.string().optional(),
    body: bodySchema,
  })
  .superRefine((v, ctx) => {
    if (v.body.type === "editElement" && Object.keys(v.body.fields).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "至少修改一个字段", path: ["body", "fields"] });
    }
    if (v.body.type === "mergeScenes" && v.body.sceneIdA === v.body.sceneIdB) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "不能合并同一场次", path: ["body"] });
    }
  });

export function parseOperation(input: unknown): Operation {
  return operationSchema.parse(input) as unknown as Operation;
}

export const resolveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("use_incoming") }),
  z.object({ action: z.literal("keep_existing") }),
  z.object({ action: z.literal("adopt_orphans") }),
  z.object({ action: z.literal("custom"), value: z.string() }),
]);

export type AnyBody = OpBody;
