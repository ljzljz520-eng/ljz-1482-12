import type { ScriptRepository } from "../domain/repository.js";

export async function createBlankScript(
  repo: ScriptRepository,
  id: string,
  title: string,
): Promise<void> {
  await repo.createScript({
    id,
    title,
    entities: { characters: [], scenes: [], lines: [], shots: [], materials: [], anchors: [], conflicts: [] },
  });
}
