import assert from "node:assert/strict";
import { it } from "node:test";
import { removeManagedSandbox } from "../src/protocol/manager-sandbox-operations.js";

it("keeps a removed sandbox record retryable when volume cleanup fails", async () => {
  let deleted = false;
  const state = {
    supervisor: {
      remove: async () => ({ sandboxId: "sbx_remove" }),
    },
    sandboxes: {
      delete: async () => {
        deleted = true;
      },
    },
    volumeProvider: {
      remove: async () => {
        throw new Error("protected volume cleanup failed");
      },
    },
  };

  await assert.rejects(
    removeManagedSandbox(state as never, {
      sandboxId: "sbx_remove",
      force: true,
      removeVolumes: true,
    }),
    /protected volume cleanup failed/,
  );
  assert.equal(deleted, false);
});
