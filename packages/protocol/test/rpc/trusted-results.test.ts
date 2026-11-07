import assert from "node:assert/strict";
import test from "node:test";
import type {
  NerveMessage,
  ProtocolRequestData,
} from "@nervekit/contracts/wire";
import { createMessageFactory } from "../../src/index.js";
import { RpcClient, RpcDispatcher } from "../../src/rpc/index.js";

const messages = createMessageFactory({
  source: { role: "ui", id: "ui_trusted" },
  target: { role: "workbench_server", id: "server_trusted" },
});

const invalidRows = [{ not: "an event" }];

function historyRequest() {
  return messages("request", {
    method: "conversation.getHistory",
    params: { conversationId: "conv_trusted", limit: 10 },
  }) as NerveMessage<ProtocolRequestData>;
}

function monitorRequest() {
  return messages("request", {
    method: "filesystem.project.monitor.sync",
    params: { projectId: "proj_trusted", directories: [""] },
  }) as NerveMessage<ProtocolRequestData>;
}

const handlers = {
  "conversation.getHistory": () => invalidRows as never,
  "filesystem.project.monitor.sync": () => ({ invalid: true }) as never,
};

test("server skips trusted result validation only when disabled", async () => {
  const skipping = new RpcDispatcher({
    handlers,
    sessionContext: true,
    validateTrustedResults: false,
  });
  assert.deepEqual(await skipping.dispatch(historyRequest()), {
    ok: true,
    result: invalidRows,
  });

  for (const validateTrustedResults of [true, undefined]) {
    const validating = new RpcDispatcher({
      handlers,
      sessionContext: true,
      validateTrustedResults,
    });
    assert.equal((await validating.dispatch(historyRequest())).ok, false);
  }
});

test("server always validates untrusted operation results", async () => {
  const dispatcher = new RpcDispatcher({
    handlers,
    sessionContext: true,
    validateTrustedResults: false,
  });
  assert.equal((await dispatcher.dispatch(monitorRequest())).ok, false);
});

async function clientResult(
  method: "conversation.getHistory" | "filesystem.project.monitor.sync",
  result: unknown,
  validateTrustedResults: boolean,
): Promise<unknown> {
  const sent: NerveMessage[] = [];
  const client = new RpcClient({
    createMessage: messages,
    send: (message) => void sent.push(message),
    validateTrustedResults,
  });
  const pending =
    method === "conversation.getHistory"
      ? client.request(method, { conversationId: "conv_trusted", limit: 10 })
      : client.request(method, {
          projectId: "proj_trusted",
          directories: [""],
        });
  const settled = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  client.handle(
    messages("response", { method, result }, { replyTo: sent[0]!.id }),
  );
  return settled;
}

test("client skips trusted result validation only when disabled", async () => {
  assert.deepEqual(
    await clientResult("conversation.getHistory", invalidRows, false),
    { value: invalidRows },
  );
  assert.ok(
    "error" in
      ((await clientResult(
        "conversation.getHistory",
        invalidRows,
        true,
      )) as object),
  );
});

test("client always validates untrusted operation results", async () => {
  assert.ok(
    "error" in
      ((await clientResult(
        "filesystem.project.monitor.sync",
        { invalid: true },
        false,
      )) as object),
  );
});
