import assert from "node:assert/strict";
import { test } from "node:test";
import { completionSearchRequestSchema } from "@nervekit/contracts/completions";
import { FileCompletionDocument } from "../../../src/domains/completions/file-completion-document.js";
import type {
  CompletionDocument,
  CompletionProvider,
} from "../../../src/domains/completions/completion-provider.js";
import {
  flush,
  deferred,
  doc,
  fakeIndex,
  fixture,
  request,
} from "./completion-service-fixture.js";

void test("public search accepts schema input, normalizes omitted fields once and still rejects invalid limits", async () => {
  const f = await fixture([
    {
      id: "files",
      ttlMs: 1000,
      load: async () => Array.from({ length: 10 }, (_, i) => doc(`file-${i}`)),
    },
  ]);
  try {
    const normalized = completionSearchRequestSchema.parse({ projectId: "p" });
    const result = await f.service.search({ projectId: "p" });
    assert.equal(f.native.queries[0]?.text, normalized.q);
    assert.equal(result.items.length, normalized.limit);
    await assert.rejects(f.service.search({ projectId: "p", limit: 64 }));
    assert.equal(
      f.native.queries.length,
      1,
      "invalid input cannot reach native acquisition/query",
    );
  } finally {
    await f.close();
  }
});

void test("evicting an idle context during native overlay update cannot leave ghost context documents", async () => {
  const native = fakeIndex();
  const started = deferred<void>();
  const release = deferred<void>();
  const update = native.index.update.bind(native.index);
  native.index.update = async (batch) => {
    if (
      batch.upsert.some(
        (document) =>
          document.id === "a-child" && document.fields[0]?.text === "a-v2",
      )
    ) {
      started.resolve();
      await release.promise;
    }
    return update(batch);
  };
  let version = 1;
  const f = await fixture(
    [
      {
        id: "children",
        scope: "conversation",
        ttlMs: 1000,
        load: async (scope) => [
          doc(`${scope.conversationId}-child`, {
            kind: "subagent",
            conversationId: scope.conversationId,
            version: `${scope.conversationId}-v${version}`,
            fields: [
              { key: "name", text: `${scope.conversationId}-v${version}` },
            ],
            item: { kind: "subagent", label: `@agent:${scope.conversationId}` },
          }),
        ],
      },
    ],
    {
      now: () => 0,
      maxContextsPerProject: 1,
      createIndex: async () => native.index,
    },
  );
  try {
    await f.service.search({ ...request, conversationId: "a", q: "agent:" });
    version = 2;
    f.service.invalidate("children", { projectId: "p", conversationId: "a" });
    await started.promise;
    const b = f.service.search({
      ...request,
      conversationId: "b",
      q: "agent:",
    });
    await flush();
    release.resolve();
    assert.deepEqual(
      (await b).items.map((item) => item.label),
      ["@agent:b"],
    );
    assert.equal(native.documents.has("a-child"), false);
    assert.equal(native.documents.has("b-child"), true);
  } finally {
    release.resolve();
    await f.close();
  }
});

void test("one project index serializes two conversation overlays, keeps files once and revalidates issued selection", async () => {
  const native = fakeIndex();
  let builds = 0;
  let fileLoads = 0;
  const enabled = new Map([
    ["a", false],
    ["b", true],
  ]);
  const versions = new Map([
    ["a", 0],
    ["b", 0],
  ]);
  const writes: string[] = [];
  const providers: CompletionProvider[] = [
    {
      id: "files",
      ttlMs: 1000,
      async load() {
        fileLoads++;
        return Array.from({ length: 100 }, (_, i) => doc(`file-${i}`));
      },
    },
    {
      id: "scoped",
      scope: "conversation",
      accessSensitive: true,
      ttlMs: 1000,
      async load(scope) {
        const conversation = scope.conversationId!;
        const version = versions.get(conversation)!;
        const tool = doc("same-tool-id", {
          kind: "tool",
          conversationId: conversation,
          version: `${conversation}:${version}`,
          item: {
            kind: "tool",
            label: "@tool:scoped",
            enabled: enabled.get(conversation),
            available: true,
            canDisable: true,
          },
          setEnabled: async (value) => {
            if (versions.get(conversation) !== version)
              throw new Error("Digest changed");
            enabled.set(conversation, value);
            versions.set(conversation, version + 1);
            writes.push(`${conversation}:${value}`);
          },
        });
        const children = Array.from(
          { length: conversation === "a" ? 70 : 1 },
          (_, i) =>
            doc(`${conversation}-child-${i}`, {
              kind: "subagent",
              conversationId: conversation,
              version: `${conversation}:${version}`,
              item: {
                kind: "subagent",
                label: `@agent:${conversation}-child-${i}`,
              },
            }),
        );
        return [tool, ...children];
      },
    },
  ];
  const f = await fixture(providers, {
    now: () => 0,
    createIndex: async () => {
      builds++;
      return native.index;
    },
  });
  try {
    const [a, b] = await Promise.all([
      f.service.search({ ...request, conversationId: "a", q: "agent:" }),
      f.service.search({ ...request, conversationId: "b", q: "agent:" }),
    ]);
    assert.ok(a.items.every((item) => item.label.startsWith("@agent:a-")));
    assert.deepEqual(
      b.items.map((item) => item.label),
      ["@agent:b-child-0"],
      "70 inaccessible A children must not displace B from native top64",
    );
    assert.equal(builds, 1);
    assert.equal(fileLoads, 1);
    const aTool = (
      await f.service.search({ ...request, conversationId: "a", q: "tool:" })
    ).items[0]!;
    const bTool = (
      await f.service.search({ ...request, conversationId: "b", q: "tool:" })
    ).items[0]!;
    assert.equal(aTool.enabled, false);
    assert.equal(bTool.enabled, true);
    const selected = await f.service.select({
      projectId: "p",
      conversationId: "a",
      documentId: aTool.documentId!,
      expectedVersion: aTool.version!,
      action: "select",
    });
    assert.equal(selected.item.enabled, true);
    assert.deepEqual(writes, ["a:true"]);
    assert.equal(
      native.documents.has("b-child-0"),
      true,
      "inactive A config selection must not replace B's native overlay",
    );
    assert.equal(native.documents.has("a-child-0"), false);
    await f.service.select({
      projectId: "p",
      conversationId: "b",
      documentId: bTool.documentId!,
      expectedVersion: bTool.version!,
      action: "disable",
    });
    assert.equal(enabled.get("a"), true);
    assert.equal(enabled.get("b"), false);
    assert.equal(
      (await f.service.search({ ...request, conversationId: "a", q: "tool:" }))
        .items[0]?.enabled,
      true,
    );
    assert.equal(builds, 1);
    assert.equal(
      native.batches
        .flatMap((batch) => batch.upsert)
        .filter((document) => document.kind === "file").length,
      100,
      "context switches never reindex the global file corpus",
    );
  } finally {
    await f.close();
  }
  assert.equal(native.closed, 1);
});

void test("compact file metadata projects only retrieved candidates, not the full corpus per query/context", async () => {
  let projections = 0;
  let discoveries = 0;
  class CountedFile extends FileCompletionDocument {
    override get item() {
      projections++;
      return super.item;
    }
  }
  const f = await fixture(
    [
      {
        id: "files",
        ttlMs: 1000,
        load: async () => {
          discoveries++;
          return Array.from(
            { length: 1000 },
            (_, i) => new CountedFile("p", `src/file-${i}.ts`, "file"),
          );
        },
      },
    ],
    { now: () => 0 },
  );
  try {
    await f.service.search({ ...request, conversationId: "a" });
    assert.equal(projections, 64);
    await f.service.search({ ...request, conversationId: "b" });
    assert.equal(projections, 128);
    assert.equal(discoveries, 1);
    assert.equal(
      f.native.batches
        .flatMap((batch) => batch.upsert)
        .filter((document) => document.kind === "file").length,
      1000,
    );
  } finally {
    await f.close();
  }
});

void test("native retrieval uses 64 before display cap; context rescues lexical rank twelve", async () => {
  const f = await fixture(
    [
      {
        id: "files",
        ttlMs: 1000,
        load: async () =>
          Array.from({ length: 16 }, (_, i) => doc(`session-${i}`)),
      },
    ],
    { context: () => ({ editedPaths: ["session-11.ts"] }) },
  );
  try {
    const result = await f.service.search(request);
    assert.equal(f.native.queriedLimit, 64);
    assert.equal(result.items.length, 8);
    assert.equal(result.items[0]?.documentId, "session-11");
    assert.deepEqual(result.items[0]?.matchRanges, [[1, 2]]);
    assert.equal(result.items[0]?.scoreFactors?.context, 1280);
    assert.equal(result.sources[0]?.status, "fresh");
  } finally {
    await f.close();
  }
});

void test("native UTF-16 matches project into primary and secondary labels for non-file sources", async () => {
  const native = fakeIndex();
  const query = native.index.query.bind(native.index);
  native.index.query = async (input) => {
    const result = await query(input);
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        matches: [
          { fieldIndex: 0, ranges: [[0, 4] as [number, number]], score: 1000 },
          { fieldIndex: 1, ranges: [[0, 2] as [number, number]], score: 1000 },
          { fieldIndex: 2, ranges: [[0, 2] as [number, number]], score: 1000 },
        ],
      })),
    };
  };
  const f = await fixture(
    [
      {
        id: "prs",
        ttlMs: 1000,
        load: async () => [
          doc("pr", {
            kind: "pull_request",
            item: {
              kind: "pull_request",
              label: "https://example.invalid/pr/12",
              displayLabel: "#12 Café",
              detail: "open · 🪴",
            },
            fields: [
              { key: "title", text: "Café" },
              { key: "identifier", text: "12" },
              { key: "description", text: "🪴" },
            ],
            displayFields: [
              { index: 0, offset: 4 },
              { index: 1, offset: 1 },
            ],
            detailFields: [{ index: 2, offset: 7 }],
          }),
        ],
      },
    ],
    { createIndex: async () => native.index },
  );
  try {
    const item = (await f.service.search(request)).items[0]!;
    assert.deepEqual(item.matchRanges, [
      [1, 3],
      [4, 8],
    ]);
    assert.deepEqual(
      item.detailMatchRanges,
      [[7, 9]],
      "emoji uses two UTF-16 units, not UTF-8 bytes",
    );
  } finally {
    await f.close();
  }
});

void test("remote loads never block typing; background completion emits and stale errors retain references", async () => {
  const gate = deferred<CompletionDocument[]>();
  let changed = 0;
  let now = 0;
  let fail = false;
  const f = await fixture(
    [
      {
        id: "remote",
        remote: true,
        ttlMs: 10,
        load: async () => {
          if (fail) throw new Error("offline");
          return gate.promise;
        },
      },
    ],
    {
      changed: () => {
        changed++;
      },
      now: () => now,
    },
  );
  try {
    const cold = await f.service.search(request);
    assert.deepEqual(cold.items, []);
    assert.equal(cold.sources[0]?.status, "loading");
    gate.resolve([doc("remote")]);
    await flush();
    assert.ok(changed > 0);
    assert.equal(
      (await f.service.search(request)).items[0]?.documentId,
      "remote",
    );
    now = 11;
    fail = true;
    assert.equal(
      (await f.service.search(request)).items[0]?.documentId,
      "remote",
    );
    await flush();
    assert.equal((await f.service.search(request)).sources[0]?.status, "stale");
  } finally {
    await f.close();
  }
});

void test("invalidated provider generations cannot publish stale loads and update only changed IDs", async () => {
  const gate = deferred<CompletionDocument[]>();
  let count = 0;
  const f = await fixture([
    {
      id: "files",
      ttlMs: 1000,
      load: async () => (++count === 1 ? gate.promise : [doc("new")]),
    },
  ]);
  try {
    const pending = f.service.search(request);
    await flush();
    f.service.invalidate("files", { projectId: "p" });
    gate.resolve([doc("old")]);
    const result = await pending;
    assert.equal(result.items[0]?.documentId, "new");
    assert.equal(f.native.documents.has("old"), false);
    f.service.invalidate("files", { projectId: "other" });
    await flush();
    assert.equal(count, 2);
    f.service.invalidate("files", { projectId: "p" });
    await flush();
    assert.equal((await f.service.search(request)).items[0]?.documentId, "new");
    assert.equal(
      f.native.batches.length,
      1,
      "unchanged source refresh must not rebuild native documents",
    );
  } finally {
    await f.close();
  }
});

void test("authorization precedes acquisition; wrong-scope provider docs never enter the index", async () => {
  let builds = 0;
  const f = await fixture(
    [
      {
        id: "files",
        ttlMs: 1000,
        load: async () => [doc("foreign", { projectId: "q" })],
      },
    ],
    {
      authorize(scope) {
        if (scope.conversationId === "foreign")
          throw new Error("Wrong project");
      },
      createIndex: async () => {
        builds++;
        return fakeIndex().index;
      },
    },
  );
  try {
    await assert.rejects(
      f.service.search({ ...request, conversationId: "foreign" }),
      /Wrong project/,
    );
    assert.equal(builds, 0);
    const result = await f.service.search(request);
    assert.deepEqual(result.items, []);
    assert.equal(result.sources[0]?.status, "unavailable");
  } finally {
    await f.close();
  }
});

void test("select revalidates versions and availability, enables through owner, explicitly disables without execution", async () => {
  let enabled = false;
  let version = 1;
  let writes = 0;
  const provider: CompletionProvider = {
    id: "skills",
    ttlMs: 1000,
    async load() {
      const digest = version;
      return [
        doc("skill", {
          kind: "skill",
          version: `v${version}`,
          item: {
            label: "@skill:skill",
            kind: "skill",
            enabled,
            available: true,
            canDisable: true,
          },
          setEnabled: async (value) => {
            if (version !== digest) throw new Error("Digest changed");
            enabled = value;
            version++;
            writes++;
          },
        }),
      ];
    },
  };
  const f = await fixture([provider]);
  try {
    const initial = (await f.service.search(request)).items[0]!;
    const selected = await f.service.select({
      projectId: "p",
      documentId: initial.documentId!,
      expectedVersion: initial.version!,
      action: "select",
    });
    assert.equal(selected.item.enabled, true);
    assert.equal(writes, 1);
    await assert.rejects(
      f.service.select({
        projectId: "p",
        documentId: "skill",
        expectedVersion: "v1",
        action: "disable",
      }),
      /changed/,
    );
    assert.equal(writes, 1);
    const disabled = await f.service.select({
      projectId: "p",
      documentId: "skill",
      expectedVersion: selected.item.version!,
      action: "disable",
    });
    assert.equal(disabled.item.enabled, false);
    assert.equal(writes, 2);
  } finally {
    await f.close();
  }
});

void test("concurrent enables retain owning digest concurrency checks", async () => {
  let version = 1;
  let writes = 0;
  const f = await fixture([
    {
      id: "skills",
      accessSensitive: true,
      ttlMs: 1000,
      async load() {
        const digest = version;
        return [
          doc("skill", {
            kind: "skill",
            version: `v${version}`,
            item: {
              label: "skill",
              kind: "skill",
              enabled: version > 1,
              available: true,
              canDisable: true,
            },
            setEnabled: async () => {
              if (version !== digest) throw new Error("Digest changed");
              version++;
              writes++;
            },
          }),
        ];
      },
    },
  ]);
  try {
    await f.service.search(request);
    const selected = {
      projectId: "p",
      documentId: "skill",
      expectedVersion: "v1",
      action: "select" as const,
    };
    const outcomes = await Promise.allSettled([
      f.service.select(selected),
      f.service.select(selected),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    assert.equal(writes, 1);
  } finally {
    await f.close();
  }
});

void test("inert references record known identity without remote rediscovery on selection", async () => {
  let loads = 0;
  const f = await fixture([
    {
      id: "files",
      ttlMs: 1000,
      load: async () => {
        loads++;
        return [doc("file")];
      },
    },
  ]);
  try {
    await f.service.search(request);
    const selected = await f.service.select({
      projectId: "p",
      documentId: "file",
      expectedVersion: "v1",
      action: "select",
    });
    assert.equal(selected.item.documentId, "file");
    assert.equal(loads, 1);
    await assert.rejects(
      f.service.select({
        projectId: "p",
        documentId: "foreign",
        expectedVersion: "v1",
        action: "select",
      }),
      /expired/,
    );
  } finally {
    await f.close();
  }
});

void test("blocked profiles cannot be selected or implicitly trusted", async () => {
  let writes = 0;
  const f = await fixture([
    {
      id: "profiles",
      ttlMs: 1000,
      load: async () => [
        doc("blocked", {
          kind: "subagent_profile",
          item: {
            kind: "subagent_profile",
            label: "blocked",
            available: false,
            unavailableReason: "Untrusted profile",
          },
          setEnabled: async () => {
            writes++;
          },
        }),
      ],
    },
  ]);
  try {
    await f.service.search(request);
    await assert.rejects(
      f.service.select({
        projectId: "p",
        documentId: "blocked",
        expectedVersion: "v1",
        action: "select",
      }),
      /Untrusted/,
    );
    assert.equal(writes, 0);
  } finally {
    await f.close();
  }
});

void test("access revocation fails closed even when native removal and owner reload fail", async () => {
  let revoked = false;
  const f = await fixture([
    {
      id: "profiles",
      accessSensitive: true,
      ttlMs: 1000,
      async load() {
        if (revoked) throw new Error("Configuration unavailable");
        return [
          doc("profile", {
            kind: "subagent_profile",
            item: {
              label: "profile",
              kind: "subagent_profile",
              enabled: true,
              available: true,
            },
          }),
        ];
      },
    },
  ]);
  try {
    assert.equal((await f.service.search(request)).items.length, 1);
    revoked = true;
    f.native.index.update = async () => {
      throw new Error("Native update unavailable");
    };
    f.service.invalidate("profiles", { projectId: "p" });
    await flush();
    const result = await f.service.search(request);
    assert.equal(
      f.native.documents.has("profile"),
      true,
      "fixture preserves native ghost after failed removal",
    );
    assert.deepEqual(
      result.items,
      [],
      "revoked metadata must never remain selectable",
    );
    assert.equal(result.sources[0]?.status, "unavailable");
  } finally {
    await f.close();
  }
});

void test("failed native index construction is evicted and the next query can recover", async () => {
  let builds = 0;
  const native = fakeIndex();
  const f = await fixture(
    [{ id: "files", ttlMs: 1000, load: async () => [doc("file")] }],
    {
      createIndex: async () => {
        if (++builds === 1) throw new Error("Temporary native failure");
        return native.index;
      },
    },
  );
  try {
    await assert.rejects(f.service.search(request));
    const recovered = await f.service.search(request);
    assert.equal(recovered.items[0]?.documentId, "file");
    assert.equal(builds, 2);
  } finally {
    await f.close();
  }
});

void test("LRU eviction closes native resources and retired background loads cannot resurrect them", async () => {
  const gate = deferred<CompletionDocument[]>();
  const created: ReturnType<typeof fakeIndex>[] = [];
  const f = await fixture(
    [
      {
        id: "remote",
        remote: true,
        ttlMs: 1000,
        load: async () => gate.promise,
      },
    ],
    {
      maxProjects: 1,
      createIndex: async () => {
        const next = fakeIndex();
        created.push(next);
        return next.index;
      },
    },
  );
  try {
    await f.service.search(request);
    await f.service.search({ ...request, projectId: "q" });
    await flush();
    assert.equal(created[0]?.closed, 1);
    gate.resolve([doc("late")]);
    await flush();
    assert.equal(created[0]?.documents.size, 0);
  } finally {
    await f.close();
  }
});
