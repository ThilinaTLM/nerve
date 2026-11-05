import assert from "node:assert/strict";
import { test } from "node:test";
import { interactionSchema } from "@nervekit/contracts/core";
import { createInteractionHandlers } from "./interaction-handlers.js";

test("every declared interaction kind has a registered handler", () => {
  const handlers = createInteractionHandlers();
  const kinds = interactionSchema.options.map(
    (option) => option.shape.kind.value,
  );
  assert.deepEqual(Object.keys(handlers).sort(), [...kinds].sort());
  for (const kind of kinds) assert.equal(handlers[kind].kind, kind);
});
