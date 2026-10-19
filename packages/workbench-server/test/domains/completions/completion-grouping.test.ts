import assert from "node:assert/strict";
import { test } from "node:test";
import { doc, fixture } from "./completion-service-fixture.js";

void test("unscoped retrieval preserves category diversity beyond a file-heavy top-k and scoped results expand", async () => {
  const kinds = [
    "file",
    "directory",
    "pull_request",
    "issue",
    "skill",
    "tool",
    "subagent_profile",
    "subagent",
    "launch",
    "launch_definition",
  ] as const;
  const documents = kinds.flatMap((kind) =>
    Array.from({ length: kind === "file" ? 100 : 8 }, (_, i) =>
      doc(`${kind}-${i}`, {
        kind,
        item: { kind, label: `${kind}-${i}` },
      }),
    ),
  );
  const f = await fixture([
    { id: "mixed", ttlMs: 1000, load: async () => documents },
  ]);
  try {
    const result = await f.service.search({ projectId: "p", q: "needle" });
    assert.equal(result.items.length, 21);
    assert.equal(result.groups?.length, 7);
    for (const group of result.groups ?? []) assert.ok(group.more > 0);
    assert.equal(
      result.items.filter(
        (item) => item.kind === "file" || item.kind === "directory",
      ).length,
      3,
    );
    const scoped = await f.service.search({
      projectId: "p",
      q: "agent:needle",
    });
    assert.equal(scoped.items.length, 12);
    assert.ok(
      scoped.items.every(
        (item) => item.kind === "subagent" || item.kind === "subagent_profile",
      ),
    );
  } finally {
    await f.close();
  }
});

void test("empty searches prioritize recorded cross-kind usage and stale selections have a conflict code", async () => {
  const file = doc("file");
  const tool = doc("tool", {
    kind: "tool",
    item: { kind: "tool", label: "tool" },
  });
  const f = await fixture([
    { id: "mixed", ttlMs: 1000, load: async () => [file, tool] },
  ]);
  try {
    await f.service.search({ projectId: "p" });
    await f.service.select({
      projectId: "p",
      documentId: tool.id,
      expectedVersion: tool.version,
      action: "select",
    });
    const recent = await f.service.search({ projectId: "p" });
    assert.equal(recent.items[0]?.kind, "tool");
    await assert.rejects(
      f.service.select({
        projectId: "p",
        documentId: tool.id,
        expectedVersion: "old",
        action: "select",
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "COMPLETION_VERSION_MISMATCH",
    );
  } finally {
    await f.close();
  }
});

void test("unknown source failures are named without inventing a settings fix or leaking provider errors", async () => {
  const f = await fixture([
    {
      id: "skills",
      ttlMs: 1000,
      load: async () => {
        throw new Error("private filesystem path");
      },
    },
  ]);
  try {
    const result = await f.service.search({ projectId: "p" });
    assert.equal(result.sources[0]?.label, "Skills");
    assert.equal(result.sources[0]?.status, "unavailable");
    assert.equal(result.sources[0]?.action, undefined);
    assert.ok(result.sources[0]?.reason);
    assert.ok(!JSON.stringify(result).includes("private filesystem path"));
  } finally {
    await f.close();
  }
});
