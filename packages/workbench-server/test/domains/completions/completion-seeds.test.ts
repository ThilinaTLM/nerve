import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completionSeedIds,
  completionStateSeeds,
  completionSeedLimit,
} from "../../../src/domains/completions/completion-seeds.js";
import {
  completionUsageId,
  rankCompletionCandidates,
} from "../../../src/domains/completions/completion-ranking-policy.js";
import { FileCompletionDocument } from "../../../src/domains/completions/file-completion-document.js";
import {
  deferred,
  doc,
  fakeIndex,
  fixture,
  flush,
  request,
} from "./completion-service-fixture.js";

void test("seed identities are bounded, prioritize edited context, validate usage kind and restrict prefix/access", () => {
  const files = Array.from(
    { length: 400 },
    (_, i) => new FileCompletionDocument("p", `src/needle-${i}.ts`, "file"),
  );
  const tool = doc("tool", {
    kind: "tool",
    item: { kind: "tool", label: "@tool:needle" },
  });
  const documents = new Map(
    [...files, tool].map((document) => [document.id, document]),
  );
  const lookup = (id: string) => documents.get(id);
  const usage = new Map([
    [completionUsageId("tool", tool.id), 4],
    [completionUsageId("skill", files[0]!.id), 100],
    ["broken", 100],
  ]);
  const ids = completionSeedIds(
    { editedPaths: files.map((file) => file.item.info!) },
    usage,
    [[{ id: "foreign-child", boost: 80 }]],
    lookup,
  );
  assert.equal(ids.length, completionSeedLimit);
  assert.deepEqual(
    ids,
    files.slice(0, completionSeedLimit).map((file) => file.id),
  );
  assert.deepEqual(
    completionSeedIds(
      { editedPaths: [files[0]!.item.info!] },
      usage,
      [[{ id: "foreign-child", boost: 80 }]],
      lookup,
      ["tool"],
    ),
    [tool.id],
  );
  assert.deepEqual(
    completionSeedIds(
      {},
      new Map([[completionUsageId("skill", files[0]!.id), 100]]),
      [],
      lookup,
    ),
    [],
  );
});

void test("refresh-time state seeds retain strongest bounded nonfile entries without projecting file items", () => {
  class UnprojectableFile extends FileCompletionDocument {
    override get item(): never {
      throw new Error("File corpus projected");
    }
  }
  const states = Array.from({ length: 400 }, (_, i) =>
    doc(`launch-${i}`, {
      kind: "launch",
      stateBoost: i + 1,
      item: { kind: "launch", label: "launch" },
    }),
  );
  const seeds = completionStateSeeds([
    new UnprojectableFile("p", "src/needle.ts", "file"),
    ...states,
  ]);
  assert.equal(seeds.length, 256);
  assert.deepEqual(seeds[0], { id: "launch-399", boost: 400 });
  assert.equal(
    seeds.some((seed) => seed.id === "launch-0"),
    false,
  );
});

void test("empty policy has no static file prior; nonempty calibration is unchanged", () => {
  const candidates = [
    {
      kind: "file" as const,
      label: "@file",
      sortScore: 0,
      scoreFactors: { lexical: 0, context: 0, usage: 0, state: 0 },
    },
    {
      kind: "launch" as const,
      label: "launch",
      sortScore: 80,
      scoreFactors: { lexical: 0, context: 0, usage: 0, state: 80 },
    },
  ];
  assert.equal(
    rankCompletionCandidates(candidates, {}, new Map(), { emptyQuery: true })[0]
      ?.kind,
    "launch",
  );
  assert.equal(rankCompletionCandidates(candidates)[0]?.kind, "file");
});

void test("same-query filtered supplemental retrieval rescues a matching file beyond64, never projects unrelated context", async () => {
  let projections = 0;
  class CountedFile extends FileCompletionDocument {
    override get item() {
      projections++;
      return super.item;
    }
  }
  const matching = "zz/needle.ts",
    unrelated = "zz/unrelated.md";
  const files = [
    ...Array.from(
      { length: 100 },
      (_, i) => new CountedFile("p", `src/needle-${i}.ts`, "file"),
    ),
    new CountedFile("p", matching, "file"),
    new CountedFile("p", unrelated, "file"),
  ];
  const native = fakeIndex();
  const query = native.index.query.bind(native.index);
  native.index.query = async (input) => {
    const result = await query(input);
    return {
      ...result,
      items: result.items.filter((item) =>
        native.documents
          .get(item.id)!
          .fields.some((field) => field.text.includes(input.text)),
      ),
    };
  };
  const f = await fixture(
    [{ id: "files", ttlMs: 1000, load: async () => files }],
    {
      context: () => ({ editedPaths: [matching, unrelated] }),
      createIndex: async () => native.index,
    },
  );
  try {
    const result = await f.service.search({ ...request, q: "needle" });
    assert.equal(result.items[0]?.info, matching);
    assert.equal(
      result.items.some((item) => item.info === unrelated),
      false,
    );
    assert.equal(
      projections,
      65,
      "64 main candidates + one matching supplemental file, no full-corpus or unrelated item projection",
    );
    assert.equal(native.queries.length, 8);
    assert.deepEqual(
      native.queries[7]?.documentIds,
      files.slice(-2).map((file) => file.id),
    );
    assert.equal(native.queries[7]?.text, native.queries[0]?.text);
    assert.equal(native.queries[7]?.limit, 2);
    await f.service.search({ ...request, q: "tool:needle" });
    assert.equal(
      native.queries.length,
      9,
      "file seeds cannot bypass a tool prefix",
    );
    assert.deepEqual(native.queries[8]?.kinds, ["tool"]);
  } finally {
    await f.close();
  }
});

for (const failure of ["revision", "filter"] as const)
  void test(`supplemental ${failure} violations fail closed`, async () => {
    const native = fakeIndex();
    const query = native.index.query.bind(native.index);
    native.index.query = async (input) => {
      const result = await query(input);
      if (input.documentIds)
        return failure === "revision"
          ? { ...result, revision: result.revision + 1 }
          : { ...result, items: [{ ...result.items[0]!, id: "escaped" }] };
      return result;
    };
    const f = await fixture(
      [
        {
          id: "launches",
          ttlMs: 1000,
          load: async () => [
            doc("running", {
              kind: "launch",
              stateBoost: 80,
              item: { kind: "launch", label: "running" },
            }),
          ],
        },
      ],
      { createIndex: async () => native.index },
    );
    try {
      await assert.rejects(
        f.service.search(request),
        failure === "revision" ? /revision mismatch/ : /identity filter/,
      );
    } finally {
      await f.close();
    }
  });

void test("one project FIFO holds both reads across conversation overlays; state seeds are current-context only", async () => {
  const native = fakeIndex();
  const started = deferred<void>(),
    release = deferred<void>();
  const calls: { ids?: string[]; installed: string[] }[] = [];
  const query = native.index.query.bind(native.index);
  native.index.query = async (input) => {
    calls.push({
      ids: input.documentIds,
      installed: [...native.documents.keys()],
    });
    if (calls.length === 1) {
      started.resolve();
      await release.promise;
    }
    return query(input);
  };
  const f = await fixture(
    [
      {
        id: "children",
        scope: "conversation",
        ttlMs: 1000,
        load: async (scope) => [
          doc(`child-${scope.conversationId}`, {
            kind: "subagent",
            conversationId: scope.conversationId,
            stateBoost: 80,
            item: { kind: "subagent", label: `@agent:${scope.conversationId}` },
          }),
        ],
      },
    ],
    { createIndex: async () => native.index },
  );
  try {
    const a = f.service.search({
      ...request,
      conversationId: "a",
      q: "agent:",
    });
    await started.promise;
    const b = f.service.search({
      ...request,
      conversationId: "b",
      q: "agent:",
    });
    await flush();
    release.resolve();
    assert.deepEqual(
      (await a).items.map((item) => item.label),
      ["@agent:a"],
    );
    assert.deepEqual(
      (await b).items.map((item) => item.label),
      ["@agent:b"],
    );
    assert.deepEqual(
      calls.map((call) => call.ids),
      [undefined, ["child-a"], undefined, ["child-b"]],
    );
    assert.deepEqual(
      calls.map((call) => call.installed),
      [["child-a"], ["child-a"], ["child-b"], ["child-b"]],
    );
  } finally {
    release.resolve();
    await f.close();
  }
});
