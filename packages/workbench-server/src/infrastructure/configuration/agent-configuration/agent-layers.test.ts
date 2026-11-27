import assert from "node:assert/strict";
import { test } from "node:test";
import type { TrustState } from "@nervekit/contracts/core";
import { applicableAgentLayers, userAgentLayer } from "./agent-layers.js";
import type { AgentDocument } from "./document-adapters.js";

const layer = (digest: string, model = "m") =>
  ({
    scope: { scope: "user" },
    path: "/home/config/agent.json",
    revision: 1,
    generation: 1,
    digest,
    document: {
      schemaVersion: 1,
      revision: 1,
      overrides: { model },
    } as unknown as AgentDocument,
  }) as const;

void test("a user agent.json that waits never replaces the last trusted version, and without one it is skipped", () => {
  const trusted = new Set<string>();
  const options = {
    agentTrustState: (_id: string | null, _path: string, digest: string) =>
      (trusted.has(digest) ? "trusted" : "needs_review") as TrustState,
  };
  const states = (value: ReturnType<typeof layer>) =>
    [{ status: "ready", value }] as never;
  // Nothing trusted yet (a restart): the file is skipped.
  assert.equal(userAgentLayer(options, layer("a")).layer, undefined);
  assert.deepEqual(applicableAgentLayers(options, states(layer("a"))), []);
  trusted.add("a");
  assert.equal(userAgentLayer(options, layer("a")).pending, false);
  // A hand edit waits; the trusted version stays in effect.
  const waiting = userAgentLayer(options, layer("b", "other"));
  assert.equal(waiting.pending, true);
  assert.equal(waiting.layer?.digest, "a");
  assert.equal(
    applicableAgentLayers(options, states(layer("b", "other")))[0].digest,
    "a",
  );
  trusted.add("b");
  assert.equal(userAgentLayer(options, layer("b", "other")).layer?.digest, "b");
});
