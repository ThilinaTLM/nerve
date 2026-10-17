import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationChannelOperations } from "../../src/domains/core/channel.js";
import { launchDefinitionOperationDefinitions } from "../../src/domains/launch-definitions/operations.js";
import {
  isWorkbenchEvent,
  isWorkbenchOperation,
} from "../../src/events/workbench-events.js";
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
