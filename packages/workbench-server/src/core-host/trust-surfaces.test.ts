import assert from "node:assert/strict";
import { test } from "node:test";
import { operationNameSchema } from "@nervekit/contracts/operations";
import { bridgeMethods } from "@nervekit/contracts/extensions";
import { allToolDescriptors } from "@nervekit/tools/catalog";
import { hostRegistry } from "./host-tools.js";

/*
 * Trust rule 3 (docs/architecture/trust.md): only the user decides. No agent tool, `quick_script`
 * namespace or extension API reaches an operation that records, withdraws or advances a trust
 * decision. This lists those operations; a new one must be classified here, and the test fails
 * until it is.
 */

/** Operations of the signed-in user's app that record, withdraw or advance a decision. */
const TRUST_MOVING = [
  // Decisions.
  "trust.decide",
  "trust.delete",
  "extensions.grantConsent",
  "extensions.revokeConsent",
  "extensions.trustProject",
  "agentProfiles.trust",
  "agentConfiguration.trust",
  "promptSuggestion.trust.update",
  "promptSuggestion.projectFile.trust",
  "permission.projectTrust.grant",
  // Saves from the UI that move a trusted digest to the bytes they wrote, or drop a decision.
  "permission.rule.save",
  "permission.rule.delete",
  "agentConfiguration.save",
  "agentConfiguration.repairApply",
  "agentProfiles.save",
  "agentProfiles.delete",
  "agentProfiles.reset",
  "extensions.save",
  "extensions.reset",
  "promptSuggestion.enabled.update",
  // MCP entries: saving approves what was written; removing drops the decision.
  "mcp.servers.save",
  "mcp.servers.remove",
] as const;

/** Operations whose name mentions trust, consent or approval but that decide nothing. */
const NOT_TRUST_MOVING = ["trust.list"] as const;

const catalog = new Set<string>(operationNameSchema.options);

/** Every id a surface the agent (or an extension) can drive exposes. */
function reachable(): Record<string, Set<string>> {
  return {
    "agent tools": new Set(allToolDescriptors().map((tool) => tool.name)),
    "quick_script namespaces": new Set(
      hostRegistry.methods.flatMap((method) => [
        `${method.product}.${method.path}`,
        method.product,
      ]),
    ),
    "extension UI bridge": new Set(
      Object.keys(bridgeMethods).flatMap((method) => [
        method,
        `extensions.ui.${method}`,
      ]),
    ),
  };
}

void test("every trust-moving operation exists in the protocol catalog", () => {
  for (const operation of [...TRUST_MOVING, ...NOT_TRUST_MOVING])
    assert.ok(catalog.has(operation), `${operation} is not an operation`);
});

void test("an operation that mentions trust, consent or approval is classified", () => {
  const classified = new Set<string>([...TRUST_MOVING, ...NOT_TRUST_MOVING]);
  const unclassified = [...catalog].filter(
    (operation) =>
      /trust|consent|approv|declin/i.test(operation) &&
      !classified.has(operation),
  );
  assert.deepEqual(
    unclassified,
    [],
    "Add each to TRUST_MOVING (and keep it off every agent surface) or to NOT_TRUST_MOVING",
  );
});

void test("no agent tool, quick_script namespace or extension API reaches a trust-moving operation", () => {
  const surfaces = reachable();
  for (const [surface, ids] of Object.entries(surfaces)) {
    assert.ok(ids.size > 0, `${surface} lists nothing`);
    const reached = TRUST_MOVING.filter((operation) => ids.has(operation));
    assert.deepEqual(
      reached,
      [],
      `${surface} reaches a trust-moving operation`,
    );
  }
});
