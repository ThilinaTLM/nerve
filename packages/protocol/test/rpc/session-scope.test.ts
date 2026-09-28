import assert from "node:assert/strict";
import test from "node:test";
import type { ProtocolRequestData } from "@nervekit/contracts/wire";
import { createMessageFactory } from "../../src/index.js";
import { RpcDispatcher } from "../../src/rpc/index.js";

const messages = createMessageFactory({
  source: { role: "ui", id: "ui_session_scope" },
  target: { role: "workbench_server", id: "server_session_scope" },
});

function monitorRequest() {
  return messages("request", {
    method: "filesystem.project.monitor.sync",
    params: { projectId: "proj_scope", directories: [""] },
  }) as ReturnType<typeof messages> & { data: ProtocolRequestData };
}

const handlers = {
  "filesystem.project.monitor.sync": () => ({
    active: true,
    degraded: false,
    watchedDirectoryCount: 1,
  }),
};

test("rejects session-scoped operations without session context", async () => {
  const dispatcher = new RpcDispatcher({ handlers });

  const result = await dispatcher.dispatch(monitorRequest());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "SESSION_REQUIRED",
      message:
        "Operation filesystem.project.monitor.sync requires a live protocol session",
      retryable: false,
    },
  });
});

test("dispatches session-scoped operations with session context", async () => {
  const dispatcher = new RpcDispatcher({ handlers, sessionContext: true });

  const result = await dispatcher.dispatch(monitorRequest());

  assert.deepEqual(result, {
    ok: true,
    result: { active: true, degraded: false, watchedDirectoryCount: 1 },
  });
});
