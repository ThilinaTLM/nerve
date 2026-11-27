import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ConfigurationReviewTarget } from "@nervekit/contracts/configuration";
import type { TrustedResource } from "@nervekit/contracts/core";
import {
  TrustedResourceService,
  type CoreStorage,
} from "@nervekit/conversation-core";
import { ConfigurationReviewService } from "../../../src/core-host/configuration/review/configuration-review.js";
import { writeExtension } from "./fixtures.js";

function memoryTrust() {
  const rows = new Map<string, TrustedResource>();
  const key = (kind: string, projectId: string | null, resourceKey: string) =>
    `${kind}|${projectId}|${resourceKey}`;
  const storage = {
    trustedResources: {
      list: () => [...rows.values()],
      find: (kind: string, projectId: string | null, resourceKey: string) =>
        rows.get(key(kind, projectId, resourceKey)) ?? null,
      insert: (row: TrustedResource) => {
        rows.set(key(row.kind, row.projectId, row.resourceKey), row);
        return row;
      },
      update: (id: string, patch: Partial<TrustedResource>) => {
        const [k, row] = [...rows].find(([, entry]) => entry.id === id)!;
        const next = { ...row, ...patch };
        rows.set(k, next);
        return next;
      },
    },
  } as unknown as CoreStorage;
  return new TrustedResourceService(storage, () => new Date().toISOString());
}

void test("an extension decision goes through its consent path with the reviewed hash; declining rejects", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-ext-review-"));
  try {
    const root = join(home, "agent", "extensions");
    const folder = await writeExtension(root, { id: "demo" });
    const granted: string[] = [];
    const reloads: (string | undefined)[] = [];
    const trust = memoryTrust();
    const service = new ConfigurationReviewService({
      home,
      trust,
      projectDirectory: () => undefined,
      agentPaths: { agent: () => "", profile: () => "" },
      skills: async () => ({ user: { skills: [] }, project: { skills: [] } }),
      suggestions: { listStatuses: async () => [] },
      extensions: {
        entries: async () => [
          {
            id: "demo",
            source: "user",
            state: "pending_consent",
            name: "demo",
            path: folder,
            diagnostics: [],
          } as never,
        ],
        grantConsent: async (_ref, hash) => {
          granted.push(hash);
          return "granted";
        },
        reload: async (id) => void reloads.push(id),
      },
      mcp: {
        review: async () => null,
        checkDecision: async () => ({}) as never,
      },
      profileRuleSetId: async () => undefined,
      decided: async () => undefined,
    });
    const target: ConfigurationReviewTarget = {
      kind: "extension",
      scope: "user",
      id: "demo",
    };
    const review = await service.review(target);
    assert.equal(review.state, "needs_review");
    assert.equal(review.kindLabel, "Extension");
    assert.ok(review.items.length > 0);
    assert.ok(review.sources.some((entry) => entry.script));
    // The first consent has nothing to compare with.
    assert.ok(review.items.every((entry) => !entry.new));

    await service.decide({ target, digest: review.digest, trusted: true });
    assert.deepEqual(granted, [review.digest]);

    await service.decide({ target, digest: review.digest, trusted: false });
    assert.equal(trust.find("extension", null, folder)?.status, "rejected");
    assert.deepEqual(reloads, ["demo"]);

    await assert.rejects(
      service.decide({ target, digest: "0".repeat(64), trusted: true }),
      /changed since you reviewed it/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
