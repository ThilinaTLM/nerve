import type { SearchQuery } from "@nervekit/native";
// Requires the native owner's rebuilt documentIds API; do not rebuild from here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSearchIndex, type SearchResult } from "@nervekit/native";
import { UnifiedCompletionService } from "../../../src/domains/completions/unified-completion-service.js";
import { CompletionUsageStore } from "../../../src/domains/completions/completion-usage-store.js";
import { completionUsageId } from "../../../src/domains/completions/completion-ranking-policy.js";
import { completionDocumentId } from "../../../src/domains/completions/completion-document-identity.js";
import {
  syntheticProviders,
  syntheticScope,
} from "../../benchmarks/completion-synthetic-providers.js";

void test("native-filtered context beyond64 really matches; both reads share revision, prefix and current-conversation scope", async () => {
  const wanted = "variants/deep/deeper/deepest/target/session.ts";
  const unrelated = "notes/unrelated.md";
  const fixture = syntheticProviders({
    allSources: true,
    paths: [
      ...Array.from(
        { length: 100 },
        (_, i) => `variants/group-${String(i).padStart(3, "0")}/session.ts`,
      ),
      wanted,
      unrelated,
    ],
  });
  const home = await mkdtemp(join(tmpdir(), "completion-native-seeds-"));
  const toolId = completionDocumentId("tool", "web_search");
  const history = new CompletionUsageStore(home, () => fixture.now);
  for (let i = 0; i < 4; i++)
    await history.record(
      syntheticScope.projectId,
      completionUsageId("tool", toolId),
    );
  const calls: { input: SearchQuery; result: SearchResult }[] = [];
  let builds = 0;
  const service = new UnifiedCompletionService({
    home,
    providers: fixture.providers,
    now: () => fixture.now,
    authorize(scope) {
      assert.equal(scope.projectId, syntheticScope.projectId);
      assert.ok(
        scope.conversationId === syntheticScope.conversationId ||
          scope.conversationId === "conv_other",
      );
    },
    context: () => ({ editedPaths: [wanted, unrelated] }),
    createIndex: async () => {
      builds++;
      const index = await createSearchIndex();
      return {
        ...index,
        async query(input) {
          const result = await index.query(input);
          calls.push({ input, result });
          return result;
        },
      };
    },
  });
  try {
    let ready = await service.search({
      ...syntheticScope,
      q: "file:session.ts",
      limit: 8,
    });
    for (
      let i = 0;
      i < 8 && ready.sources.some((source) => source.status === "loading");
      i++
    ) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      ready = await service.search({
        ...syntheticScope,
        q: "file:session.ts",
        limit: 8,
      });
    }
    assert.ok(ready.sources.every((source) => source.status === "fresh"));
    calls.length = 0;
    const response = await service.search({
      ...syntheticScope,
      q: "file:session.ts",
      limit: 8,
    });
    const wantedId = completionDocumentId("file", wanted),
      unrelatedId = completionDocumentId("file", unrelated);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.result.items.length, 64);
    assert.equal(
      calls[0]?.result.items.some((item) => item.id === wantedId),
      false,
    );
    assert.ok(calls[1]?.input.documentIds?.includes(wantedId));
    assert.ok(calls[1]?.input.documentIds?.includes(unrelatedId));
    assert.ok(calls[1]?.result.items.some((item) => item.id === wantedId));
    assert.equal(
      calls[1]?.result.items.some((item) => item.id === unrelatedId),
      false,
    );
    assert.deepEqual(
      calls.map((call) => call.input.text),
      ["session.ts", "session.ts"],
    );
    assert.deepEqual(
      calls.map((call) => call.input.kinds),
      [
        ["file", "directory"],
        ["file", "directory"],
      ],
    );
    assert.ok(
      calls.every((call) => call.result.revision === response.revision),
    );
    assert.equal(response.items[0]?.documentId, wantedId);
    assert.equal(
      response.items.some((item) => item.documentId === unrelatedId),
      false,
    );
    assert.ok(
      response.items[0]!.scoreFactors!.lexical > 0,
      "lexical evidence is native, not synthesized from context",
    );
    calls.length = 0;
    const tools = await service.search({
      ...syntheticScope,
      q: "tool:",
      limit: 8,
    });
    assert.equal(tools.items[0]?.documentId, toolId);
    assert.ok(
      calls[1]?.input.documentIds?.every((id) => JSON.parse(id)[0] === "tool"),
    );
    assert.ok(calls[1]!.input.documentIds!.length <= 256);
    assert.ok(calls.every((call) => call.result.revision === tools.revision));
    const children = await service.search({
      ...syntheticScope,
      q: "agent:",
      limit: 8,
    });
    assert.ok(children.items.some((item) => item.kind === "subagent"));
    calls.length = 0;
    const other = await service.search({
      ...syntheticScope,
      conversationId: "conv_other",
      q: "agent:",
      limit: 8,
    });
    assert.ok(other.items.every((item) => item.kind !== "subagent"));
    assert.ok(
      calls.every((call) =>
        call.result.items.every(
          (item) => !item.id.includes("conv_child_synthetic"),
        ),
      ),
    );
    assert.equal(builds, 1);
  } finally {
    await service.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
