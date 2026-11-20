import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { bridgeProtocolVersion } from "@nervekit/contracts/extensions";
import {
  BridgeError,
  createBridgeClient,
  startFrameErrorReporting,
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

void test("frame errors are posted once each, shortened, capped and never throw", () => {
  const target = new EventTarget();
  const posted: {
    error: { kind: string; message: string; source?: string };
  }[] = [];
  startFrameErrorReporting(target, (message) => posted.push(message as never));
  const fire = (type: string, fields: object) =>
    target.dispatchEvent(Object.assign(new Event(type), fields));

  fire("error", {
    message: "boom",
    error: new Error("boom"),
    filename: "https://ext.example/assets/main.js?v=1#x",
    lineno: 7,
  });
  fire("error", {
    message: "boom",
    error: new Error("boom"),
    filename: "https://ext.example/assets/main.js?v=1#x",
    lineno: 7,
  });
  fire("unhandledrejection", { reason: new Error("later") });
  fire("unhandledrejection", { reason: "plain" });
  fire("securitypolicyviolation", {
    violatedDirective: "connect-src",
    effectiveDirective: "connect-src",
    blockedURI: "https://api.example.com/v1/data?token=secret",
    sourceFile: "",
    lineNumber: 0,
  });
  assert.deepEqual(
    posted.map((entry) => entry.error),
    [
      {
        kind: "error",
        message: "boom",
        source: "https://ext.example/assets/main.js:7",
      },
      { kind: "unhandledrejection", message: "later" },
      { kind: "unhandledrejection", message: "plain" },
      {
        kind: "csp",
        message: "Blocked by connect-src: https://api.example.com/v1/data",
      },
    ],
  );
  assert.equal(
    (posted[0] as unknown as { nerveBridge: number; type: string }).type,
    "frameError",
  );
  for (let index = 0; index < 50; index += 1)
    fire("unhandledrejection", { reason: `again ${index}` });
  assert.equal(posted.length, 20);
  // A transport that throws must not break the listener.
  const broken = new EventTarget();
  startFrameErrorReporting(broken, () => {
    throw new Error("closed");
  });
  assert.doesNotThrow(() =>
    broken.dispatchEvent(Object.assign(new Event("error"), { message: "x" })),
  );
});

void test("the fake bridge records clipboard writes and refuses them without a user gesture", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const globals = globalThis as Record<string, unknown>;
  globals["document"] = dom.window.document;
  const allowed = createFakeBridge({ kind: "page" });
  try {
    await allowed.ready;
    await host.clipboard.writeText("copied");
    await host.clipboard.writeImage(new Uint8Array([1, 2, 3]), "image/png");
    await host.clipboard.writeImage(
      new Blob([new Uint8Array([4])], { type: "image/webp" }),
    );
    assert.equal(allowed.clipboard[0]?.text, "copied");
    assert.deepEqual([...allowed.clipboard[1]!.image!.bytes], [1, 2, 3]);
    assert.equal(allowed.clipboard[2]!.image!.mediaType, "image/webp");
  } finally {
    allowed.close();
  }
  const refused = createFakeBridge({ kind: "page", userActivation: false });
  try {
    await refused.ready;
    await assert.rejects(
      host.clipboard.writeText("x"),
      (error: unknown) =>
        error instanceof BridgeError && error.code === "not_allowed",
    );
    assert.deepEqual(refused.clipboard, []);
  } finally {
    refused.close();
    delete globals["document"];
  }
});

void test("the fake bridge store keeps revisions, detects conflicts and emits changes", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const globals = globalThis as Record<string, unknown>;
  globals["document"] = dom.window.document;
  const bridge = createFakeBridge({ kind: "panel", store: { "a.seed": 1 } });
  try {
    await bridge.ready;
    assert.deepEqual(await host.extensionStore.get("missing"), {
      value: null,
      revision: null,
    });
    assert.deepEqual(await host.extensionStore.get("a.seed"), {
      value: 1,
      revision: 1,
    });
    assert.deepEqual(
      await host.extensionStore.set("doc", { n: 1 }, { ifRevision: 0 }),
      { revision: 1 },
    );
    await assert.rejects(
      host.extensionStore.set("doc", { n: 2 }, { ifRevision: 0 }),
      (error: unknown) =>
        error instanceof BridgeError && error.code === "conflict",
    );
    assert.deepEqual(
      await host.extensionStore.set("doc", { n: 2 }, { ifRevision: 1 }),
      { revision: 2 },
    );
    await assert.rejects(
      host.extensionStore.delete("doc", { ifRevision: 1 }),
      (error: unknown) =>
        error instanceof BridgeError && error.code === "conflict",
    );
    assert.deepEqual(
      (await host.extensionStore.keys("d")).map((entry) => [
        entry.key,
        entry.revision,
      ]),
      [["doc", 2]],
    );
    await host.extensionStore.delete("doc", { ifRevision: 2 });
    assert.equal(bridge.store.has("doc"), false);

    const changes: unknown[] = [];
    host.onExtensionStoreChange((change) => changes.push(change));
    bridge.emitExtensionStoreChanged("doc", 3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(changes, [{ key: "doc", revision: 3 }]);
  } finally {
    bridge.close();
    delete globals["document"];
  }
});
