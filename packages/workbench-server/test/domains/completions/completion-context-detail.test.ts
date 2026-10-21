import assert from "node:assert/strict";
import { test } from "node:test";
import { createSearchIndex } from "@nervekit/native";
import {
  syntheticProviders,
  syntheticScope,
} from "../../benchmarks/completion-synthetic-providers.js";
import { fixture } from "./completion-service-fixture.js";

void test("grouped row details contain only context and native detail highlights align with that context", async () => {
  const synthetic = syntheticProviders({ paths: [], allSources: true });
  const f = await fixture(synthetic.providers, {
    createIndex: createSearchIndex,
    now: () => synthetic.now,
  });
  try {
    const cases = [
      {
        query: "tool:topic",
        kind: "tool",
        detail: "Search an invented topic",
        word: "topic",
      },
      {
        query: "skill:review",
        kind: "skill",
        detail: "Invented project review skill",
        word: "review",
      },
      {
        query: "agent:review",
        kind: "agent_profile",
        detail: "Invented review profile",
        word: "review",
      },
      {
        query: "launch:printf",
        kind: "launch_definition",
        detail: "printf 'synthetic beacon'",
        word: "printf",
      },
      {
        query: "agent:child",
        kind: "subagent",
        detail: "conv_child_synthetic",
        word: "child",
      },
    ];
    for (const { query, kind, detail, word } of cases) {
      const response = await f.service.search({ ...syntheticScope, q: query });
      const item = response.items.find((item) => item.kind === kind);
      assert.ok(item, query);
      assert.equal(item.detail, detail, query);
      const start = detail.indexOf(word);
      assert.deepEqual(
        item.detailMatchRanges,
        [[start, start + word.length]],
        `${query}: highlight uses the context-only detail offset`,
      );
      if (kind === "skill") assert.equal(item.info, "nerve");
      if (kind === "subagent") assert.equal(item.status, "running");
    }
    // Profile names remain a native identifier field even though the row detail
    // no longer repeats them alongside the description.
    const profile = (
      await f.service.search({ ...syntheticScope, q: "profile:cobalt" })
    ).items[0];
    assert.equal(profile?.kind, "agent_profile");
    assert.equal(profile?.detail, "Invented review profile");
    assert.deepEqual(profile?.detailMatchRanges, []);
  } finally {
    await f.close();
  }
});
