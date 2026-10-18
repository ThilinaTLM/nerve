import type { SearchQuery, SearchResult } from "@nervekit/native";
import type {
  CompletionDocument,
  CompletionSearchIndex,
} from "./completion-provider.js";
import type { CompletionContext } from "./completion-ranking-policy.js";
import { completionDocumentId } from "./completion-document-identity.js";

export const completionSeedLimit = 256;
export type CompletionStateSeed = { id: string; boost: number };
const stateOrder = (a: CompletionStateSeed, b: CompletionStateSeed) =>
  b.boost - a.boost || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Built on provider refresh, never by walking the file corpus per keystroke. */
export function completionStateSeeds(
  documents: Iterable<CompletionDocument>,
): CompletionStateSeed[] {
  let seeds: CompletionStateSeed[] = [];
  for (const document of documents) {
    if (
      document.kind === "file" ||
      document.kind === "directory" ||
      !Number.isFinite(document.stateBoost) ||
      !(document.stateBoost! > 0)
    )
      continue;
    seeds.push({ id: document.id, boost: document.stateBoost! });
    if (seeds.length === completionSeedLimit * 2)
      seeds = seeds.sort(stateOrder).slice(0, completionSeedLimit);
  }
  return seeds.sort(stateOrder).slice(0, completionSeedLimit);
}

/** Known identities only, with deterministic priority and a single shared cap.
 * Reads at most bounded context/usage/state metadata; no file iteration/items. */
export function completionSeedIds(
  context: CompletionContext,
  usage: ReadonlyMap<string, number>,
  state: Iterable<readonly CompletionStateSeed[]>,
  lookup: (id: string) => CompletionDocument | undefined,
  kinds?: readonly string[],
): string[] {
  const ids = new Set<string>();
  const add = (id: string, kind?: string) => {
    if (ids.size >= completionSeedLimit) return;
    const document = lookup(id);
    if (
      document &&
      (!kind || document.kind === kind) &&
      (!kinds || kinds.includes(document.kind))
    )
      ids.add(id);
  };
  const paths = (paths?: readonly string[]) => {
    for (const path of paths?.slice(0, completionSeedLimit) ?? []) {
      add(completionDocumentId("file", path));
      add(completionDocumentId("directory", path.replace(/\/$/, "")));
    }
  };
  paths(context.editedPaths);
  paths(context.referencedPaths);
  // The usage store itself is capped at 1,000 entries. Parse kind-namespaced
  // identities, never client patches or filenames to open.
  for (const [key] of [...usage]
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    if (ids.size >= completionSeedLimit) break;
    try {
      const value: unknown = JSON.parse(key);
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === "string" &&
        typeof value[1] === "string"
      )
        add(value[1], value[0]);
    } catch {
      /* Corrupt optional usage cannot grant a seed. */
    }
  }
  paths(context.openPaths);
  for (const seed of [...state].flat().sort(stateOrder)) add(seed.id);
  return [...ids];
}

/** Caller holds the project FIFO across both reads and the active overlay. */
export async function retrieveCompletionCandidates(
  index: CompletionSearchIndex,
  input: SearchQuery,
  seedIds: string[],
  revision: number,
): Promise<SearchResult> {
  const result = await index.query({ ...input, limit: 64 });
  if (result.revision !== revision)
    throw new Error("Completion index revision mismatch");
  if (!seedIds.length) return result;
  const query: SearchQuery = {
    ...input,
    documentIds: seedIds,
    limit: seedIds.length,
  };
  const supplement = await index.query(query);
  if (supplement.revision !== revision)
    throw new Error("Completion index revision mismatch");
  const allowed = new Set(seedIds);
  if (supplement.items.some((item) => !allowed.has(item.id)))
    throw new Error("Native completion identity filter was not honored");
  const ids = new Set(result.items.map((item) => item.id));
  return {
    revision,
    items: [
      ...result.items,
      ...supplement.items.filter((item) => {
        if (ids.has(item.id)) return false;
        ids.add(item.id);
        return true;
      }),
    ],
  };
}
