import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { bridgeProtocolVersion } from "@nervekit/contracts/extensions";
import {
  BridgeError,
  createBridgeClient,
  type BridgeTransport,
} from "../src/ui/client.ts";
import { host, mode, themeKind } from "../src/ui/host.ts";
import { createFakeBridge } from "../src/ui/testing.ts";

const envelope = { nerveBridge: bridgeProtocolVersion };
const initMessage = {
  ...envelope,
  type: "init",
  contribution: { kind: "preview", id: "table", edit: "source" },
  extensionId: "csv-viewer",
  mode: "preview",
  themeKind: "dark",
  tokensCss: "--background:#111;",
  baseCssUrl: "base.css",
};

/** A transport the test drives by hand: it records what the client posts. */
function manualTransport() {
  const posted: Record<string, unknown>[] = [];
  let deliver: (data: unknown) => void = () => undefined;
  const transport: BridgeTransport = {
    post: (message) => posted.push(message as Record<string, unknown>),
    listen(handler) {
      deliver = handler;
      return () => undefined;
    },
  };
  return { transport, posted, deliver: (data: unknown) => deliver(data) };
}

void test("the client sends ready, resolves on init and ignores foreign messages", async () => {
  const { transport, posted, deliver } = manualTransport();
  const client = createBridgeClient(transport);
  assert.deepEqual(posted[0], { ...envelope, type: "ready" });
  deliver({ type: "init" }); // no protocol marker: not ours
  deliver({ ...initMessage, extensionId: 3 }); // invalid init rejects the handshake
  await assert.rejects(client.ready, /invalid init/);
  client.close();
  const second = manualTransport();
  const ok = createBridgeClient(second.transport);
  second.deliver(initMessage);
  const init = await ok.ready;
  assert.equal(init.extensionId, "csv-viewer");
  assert.equal(init.baseCssUrl, "base.css");
  ok.close();
});

void test("requests are validated, correlated and answered with results or errors", async () => {
  const { transport, posted, deliver } = manualTransport();
  const client = createBridgeClient(transport);
  deliver(initMessage);
  await client.ready;

  // Invalid params never leave the frame.
  await assert.rejects(
    client.request("file.read", { length: -1 }),
    (error: unknown) =>
      error instanceof BridgeError && error.code === "invalid_request",
  );
  assert.equal(
    posted.filter((message) => message["type"] === "request").length,
    0,
  );

  const first = client.request("project.info", {});
  const second = client.request("settings.get", {});
  const [a, b] = posted.filter((message) => message["type"] === "request");
  assert.notEqual(a!["id"], b!["id"]);
  // Answered out of order.
  deliver({
    ...envelope,
    type: "response",
    id: b!["id"],
    ok: true,
    result: { values: { limit: 3 } },
  });
  deliver({
    ...envelope,
    type: "response",
    id: a!["id"],
    ok: false,
    error: { code: "not_found", message: "no project" },
  });
  assert.deepEqual(await second, { values: { limit: 3 } });
  await assert.rejects(
    first,
    (error: unknown) =>
      error instanceof BridgeError &&
      error.code === "not_found" &&
      error.message === "no project",
  );

  // A result that breaks the contract is an error, not a silent wrong value.
  const third = client.request("project.info", {});
  const id = posted.filter((message) => message["type"] === "request")[2]![
    "id"
  ];
  deliver({ ...envelope, type: "response", id, ok: true, result: { id: 1 } });
  await assert.rejects(third, /unexpected result/);

  const pending = client.request("project.info", {});
  client.close();
  await assert.rejects(pending, /closed/);
});

void test("events reach listeners with validated payloads", async () => {
  const { transport, deliver } = manualTransport();
  const client = createBridgeClient(transport);
  deliver(initMessage);
  await client.ready;
  const seen: unknown[] = [];
  const stop = client.on("fileChanged", (change) => seen.push(change));
  deliver({
    ...envelope,
    type: "event",
    event: "fileChanged",
    data: { size: 4 },
  });
  deliver({
    ...envelope,
    type: "event",
    event: "fileChanged",
    data: { size: "x" },
  });
  deliver({ ...envelope, type: "event", event: "nope", data: {} });
  stop();
  deliver({
    ...envelope,
    type: "event",
    event: "fileChanged",
    data: { size: 5 },
  });
  assert.deepEqual(seen, [{ size: 4 }]);
  client.close();
});

void test("host with the fake bridge: handshake, theme, files, host UI and events", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const globals = globalThis as Record<string, unknown>;
  globals["document"] = dom.window.document;
  const bridge = createFakeBridge({
    kind: "preview",
    edit: "custom",
    file: { path: "data/a.csv", content: "x,y\n1,2\n" },
    settings: { limit: 3 },
    call: (method, args) => ({ method, args: args ?? null }),
    themeKind: "light",
    tokensCss: "--background:#fff;--foreground:#111;",
  });
  try {
    await host.ready;
    const root = dom.window.document.documentElement;
    assert.equal(root.dataset["colorMode"], "light");
    assert.equal(root.style.getPropertyValue("--background"), "#fff");
    assert.equal(host.extensionId, "test-extension");
    assert.equal(host.contribution.kind, "preview");

    assert.equal((await host.file.info()).extension, ".csv");
    assert.equal(await host.file.text(), "x,y\n1,2\n");
    await host.file.write("a,b\n");
    assert.equal(bridge.fileText, "a,b\n");
    await host.file.write(new Uint8Array([1, 2, 3]));
    assert.deepEqual([...bridge.fileBytes], [1, 2, 3]);
    assert.equal(await host.mode.get(), "preview");
    assert.deepEqual(await host.settings.get(), { limit: 3 });
    assert.deepEqual(await host.call("ns.run", { a: 1 }), {
      method: "ns.run",
      args: { a: 1 },
    });
    assert.equal(await host.ui.confirm({ title: "Sure?" }), true);
    assert.equal(await host.ui.showMenu([{ id: "a", label: "A" }]), "a");
    await host.ui.notify("hi", "success");
    await host.openFile("b.txt");
    await host.composer.insert("text");
    assert.deepEqual(bridge.notifications, [
      { message: "hi", level: "success" },
    ]);
    assert.deepEqual(bridge.opened.files, ["b.txt"]);

    // Events: theme tokens are applied by the SDK, mode and file changes reach the handlers.
    let kind: string | undefined;
    const modes: string[] = [];
    const changes: number[] = [];
    host.onThemeChange((change) => (kind = change.kind));
    host.onModeChange((change) => modes.push(change.mode));
    host.onFileChange((change) => changes.push(change.size));
    const modeValues: string[] = [];
    const stopMode = mode.subscribe((value) => modeValues.push(value));
    const themeValues: string[] = [];
    const stopTheme = themeKind.subscribe((value) => themeValues.push(value));
    bridge.emitThemeChanged("dark", "--background:#000;");
    bridge.emitModeChanged("edit");
    bridge.emitFileChanged({ size: 9 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stopMode();
    stopTheme();
    assert.equal(kind, "dark");
    assert.equal(root.dataset["colorMode"], "dark");
    assert.equal(root.style.getPropertyValue("--background"), "#000");
    assert.deepEqual(modes, ["edit"]);
    assert.equal(modeValues.at(-1), "edit");
    assert.equal(themeValues.at(-1), "dark");
    assert.deepEqual(changes, [9]);
  } finally {
    bridge.close();
    delete globals["document"];
  }
});

void test("the fake bridge refuses what Nerve refuses", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const globals = globalThis as Record<string, unknown>;
  globals["document"] = dom.window.document;
  // A source-edit preview has no file.write; a panel has no file access at all.
  const preview = createFakeBridge({ file: { content: "x" } });
  try {
    await preview.ready;
    await assert.rejects(
      host.file.write("y"),
      (error: unknown) =>
        error instanceof BridgeError && error.code === "not_allowed",
    );
    await assert.rejects(host.call("a.b"), /backend_error|no `call` handler/);
  } finally {
    preview.close();
  }
  const panel = createFakeBridge({ kind: "panel" });
  try {
    await panel.ready;
    await assert.rejects(
      host.file.info(),
      (error: unknown) =>
        error instanceof BridgeError && error.code === "not_allowed",
    );
    assert.equal((await host.project.info()).name, "project");
  } finally {
    panel.close();
    delete globals["document"];
  }
});
