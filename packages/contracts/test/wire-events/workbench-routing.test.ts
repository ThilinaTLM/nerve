import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationChannelOperations } from "../../src/domains/core/channel.js";
import { launchDefinitionOperationDefinitions } from "../../src/domains/launch-definitions/operations.js";
import {
  isWorkbenchEvent,
  isWorkbenchOperation,
} from "../../src/events/workbench-events.js";
import {
  publicEventDefinition,
  validatePublicEvent,
} from "../../src/events/catalog.js";
import { projectEventDefinitions } from "../../src/domains/projects/events.js";
import { allOperationDefinitions } from "../../src/operations/catalog.js";

void test("all catalog operations route to their owning workbench or conversation surface", () => {
  const conversationMethods = new Set<string>(
    conversationChannelOperations.map(({ method }) => method),
  );
  for (const { method } of allOperationDefinitions()) {
    assert.equal(
      isWorkbenchOperation(method),
      !conversationMethods.has(method),
      `Wrong operation surface for ${method}`,
    );
  }
});

void test("every declared launch definition, folder and catalog operation belongs to workbench", () => {
  for (const { method } of launchDefinitionOperationDefinitions) {
    assert.equal(isWorkbenchOperation(method), true, method);
  }
});

void test("launch catalog invalidation events remain distinct from management operations", () => {
  assert.equal(isWorkbenchEvent("launchCatalog.changed"), true);
  for (const { method } of launchDefinitionOperationDefinitions) {
    if (!method.startsWith("launchCatalog."))
      assert.equal(isWorkbenchEvent(method), false, method);
  }
  assert.equal(isWorkbenchEvent("conversation.event"), false);
  assert.equal(isWorkbenchOperation("conversation.getSnapshot"), false);
});

void test("project configuration health is a published, ephemeral workbench notice", () => {
  // Publishing an event missing from the catalog throws on the server, which
  // silently dropped every health update to mounted UIs.
  for (const { name } of projectEventDefinitions)
    assert.ok(publicEventDefinition(name), `${name} is not in the catalog`);
  assert.equal(
    publicEventDefinition("project.configuration.health")?.delivery,
    "ephemeral",
  );
  const health = { projectId: "proj_a", issues: [] };
  assert.deepEqual(
    validatePublicEvent(
      "project.configuration.health",
      health,
      "workbench_server",
    ),
    health,
  );
});
