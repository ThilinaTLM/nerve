import type { SearchQuery } from "@nervekit/native";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnifiedCompletionService } from "../../../src/domains/completions/unified-completion-service.js";
import type {
  CompletionDocument,
  CompletionProvider,
  CompletionSearchIndex,
  SearchDocument,
} from "../../../src/domains/completions/completion-provider.js";

export const flush = () =>
  new Promise<void>((resolve) => setImmediate(resolve));
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
export function doc(
  id: string,
  extra: Partial<CompletionDocument> = {},
): CompletionDocument {
  return {
    id,
    projectId: "p",
    kind: "file",
    fields: [{ key: "path", text: `${id}.ts` }],
    version: "v1",
    item: { kind: "file", label: `@${id}.ts`, info: `${id}.ts` },
    displayField: { index: 0, offset: 1 },
    ...extra,
  };
}
export function fakeIndex() {
  const documents = new Map<string, SearchDocument>();
  const batches: {
    upsert: readonly SearchDocument[];
    remove: readonly string[];
  }[] = [];
  const queries: SearchQuery[] = [];
  let revision = 0;
  let closed = 0;
  let queriedLimit = 0;
  const index: CompletionSearchIndex = {
    async update(batch) {
      batches.push(batch);
      batch.remove.forEach((id) => documents.delete(id));
      batch.upsert.forEach((document) => documents.set(document.id, document));
      return { revision: ++revision };
    },
    async query(query) {
      const ids = query.documentIds;
      queries.push({ ...query, ...(ids ? { documentIds: [...ids] } : {}) });
      queriedLimit = query.limit ?? 0;
      return {
        revision,
        items: [...documents.values()]
          .filter(
            (document) =>
              (!ids || ids.includes(document.id)) &&
              (!query.kinds || query.kinds.includes(document.kind)),
          )
          .slice(0, query.limit)
          .map((document, i) => ({
            id: document.id,
            lexicalScore: 1000 - i * 10,
            matches: [
              { fieldIndex: 0, ranges: [[0, 1]], score: 1000 - i * 10 },
            ],
          })),
      };
    },
    async close() {
      closed++;
    },
  };
  return {
    index,
    queries,
    batches,
    documents,
    get closed() {
      return closed;
    },
    get queriedLimit() {
      return queriedLimit;
    },
  };
}
export async function fixture(
  providers: CompletionProvider[],
  options: Partial<
    ConstructorParameters<typeof UnifiedCompletionService>[0]
  > = {},
) {
  const home = await mkdtemp(join(tmpdir(), "unified-completion-"));
  const native = fakeIndex();
  const service = new UnifiedCompletionService({
    home,
    authorize() {},
    context: () => ({}),
    providers,
    createIndex: async () => native.index,
    ...options,
  });
  return {
    service,
    native,
    home,
    async close() {
      await service.dispose();
      await rm(home, { recursive: true, force: true });
    },
  };
}
export const request = { projectId: "p", q: "session", limit: 8 };
