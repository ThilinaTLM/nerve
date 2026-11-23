import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bridgeFrameMessageSchema,
  bridgeInitSchema,
  bridgeLimits,
  bridgeMethodNames,
  bridgeRequestSchema,
  bridgeResponseSchema,
  isBridgeMethodAllowed,
  validateBridgeRequest,
} from "../../src/domains/extensions/index.js";

const request = (method: string, params?: unknown) =>
  bridgeRequestSchema.parse({
    nerveBridge: 1,
    type: "request",
    id: "1",
    method,
    params,
  });

test("envelopes are versioned and strict", () => {
  assert.equal(
    bridgeRequestSchema.safeParse({
      type: "request",
      id: "1",
      method: "backend.call",
    }).success,
    false,
  );
  assert.equal(
    bridgeResponseSchema.safeParse({
      nerveBridge: 1,
      type: "response",
      id: "1",
      ok: false,
      error: { code: "failed", message: "x" },
    }).success,
    true,
  );
  assert.equal(
    bridgeResponseSchema.safeParse({
      nerveBridge: 1,
      type: "response",
      id: "1",
      ok: false,
      error: { code: "nope", message: "x" },
    }).success,
    false,
  );
  assert.equal(
    bridgeInitSchema.safeParse({
      nerveBridge: 1,
      type: "init",
      contribution: { kind: "preview", id: "table", edit: "custom" },
      extensionId: "csv-tools",
      mode: "preview",
      themeKind: "dark",
      tokensCss: "--background:#000;",
      baseCssUrl: "/x/base.css",
    }).success,
    true,
  );
});

test("methods are limited by contribution kind and edit mode", () => {
  assert.equal(isBridgeMethodAllowed("file.read", { kind: "page" }), false);
  assert.equal(
    isBridgeMethodAllowed("file.read", { kind: "preview", edit: "none" }),
    true,
  );
  assert.equal(
    isBridgeMethodAllowed("file.write", { kind: "preview", edit: "source" }),
    false,
  );
  assert.equal(
    isBridgeMethodAllowed("file.write", { kind: "preview", edit: "custom" }),
    true,
  );
  assert.equal(isBridgeMethodAllowed("backend.call", { kind: "panel" }), true);
  assert.equal(bridgeMethodNames.length, 22);
});

test("requests are validated against the method", () => {
  const page = { kind: "page" } as const;
  assert.deepEqual(validateBridgeRequest(request("nope"), page), {
    ok: false,
    error: { code: "unknown_method", message: "Unknown method nope" },
  });
  const denied = validateBridgeRequest(request("file.info"), page);
  assert.equal(!denied.ok && denied.error.code, "not_allowed");
  assert.equal(
    validateBridgeRequest(
      request("backend.call", { method: "csv.sum", args: { a: 1 } }),
      page,
    ).ok,
    true,
  );
  const bad = validateBridgeRequest(
    request("pages.open", { id: "Bad Id" }),
    page,
  );
  assert.equal(!bad.ok && bad.error.code, "invalid_request");
  const big = validateBridgeRequest(
    request("tabState.set", {
      state: "x".repeat(bridgeLimits.maxTabStateBytes),
    }),
    page,
  );
  assert.equal(!big.ok && big.error.code, "invalid_request");
  assert.equal(
    validateBridgeRequest(
      request("file.read", { length: bridgeLimits.maxReadChunkBytes + 1 }),
      { kind: "preview", edit: "none" },
    ).ok,
    false,
  );
});

test("store keys are file-name safe and writes take an optional revision", () => {
  const valid = (params: unknown) =>
    validateBridgeRequest(request("store.set", params), {
      kind: "page",
    }).ok;
  assert.equal(valid({ key: "drawing-1.v2", value: { a: 1 } }), true);
  assert.equal(valid({ key: "a", value: null, ifRevision: 0 }), true);
  for (const key of [".hidden", "../x", "a/b", "", "x".repeat(129)])
    assert.equal(valid({ key, value: 1 }), false, key);
  assert.equal(valid({ key: "a", value: 1, ifRevision: -1 }), false);
  assert.equal(
    valid({
      key: "a",
      value: "x".repeat(bridgeLimits.maxStoreValueBytes),
    }),
    false,
  );
});

test("clipboard images are base64 within the size limit", () => {
  const valid = (params: unknown) =>
    validateBridgeRequest(request("clipboard.writeImage", params), {
      kind: "panel",
    }).ok;
  assert.equal(valid({ dataBase64: "iVBORw0K", mediaType: "image/png" }), true);
  assert.equal(
    valid({ dataBase64: "not base64!", mediaType: "image/png" }),
    false,
  );
  assert.equal(valid({ dataBase64: "AAAA", mediaType: "image/gif" }), false);
  const tooBig = "A".repeat(
    Math.ceil((bridgeLimits.maxClipboardImageBytes * 4) / 3) + 8,
  );
  assert.equal(valid({ dataBase64: tooBig, mediaType: "image/png" }), false);
});

test("frame errors are a bounded envelope without an id", () => {
  const ok = bridgeFrameMessageSchema.safeParse({
    nerveBridge: 1,
    type: "frameError",
    error: { kind: "csp", message: "style-src blocked", source: "inline" },
  });
  assert.equal(ok.success, true);
  assert.equal(
    bridgeFrameMessageSchema.safeParse({
      nerveBridge: 1,
      type: "frameError",
      error: { kind: "csp", message: "x".repeat(1001) },
    }).success,
    false,
  );
});

test("menus take the whole tree within the limits, picks take bounded items", () => {
  const page = { kind: "page" } as const;
  const anchor = { x: 4, y: 8, width: 20 };
  const item = (id: string) => ({ id, label: id });
  const menu = (entries: unknown[]) =>
    validateBridgeRequest(request("ui.menu", { entries, anchor }), page);
  assert.equal(
    menu([
      { type: "label", label: "File" },
      { ...item("a"), icon: "file-text", checked: true, shortcut: "Ctrl+A" },
      { type: "separator" },
      {
        type: "submenu",
        label: "More",
        items: [{ type: "submenu", label: "Deep", items: [item("b")] }],
      },
    ]).ok,
    true,
  );
  const failure = (entries: unknown[]) => {
    const result = menu(entries);
    return !result.ok && result.error.code === "invalid_request"
      ? result.error.message
      : undefined;
  };
  // Three levels of submenus, duplicate ids, nothing to choose, too many entries, bad icon names.
  const sub = (items: unknown[]) => ({ type: "submenu", label: "S", items });
  assert.match(
    failure([sub([sub([sub([item("a")])])])]) ?? "",
    /nest at most 2/,
  );
  assert.match(failure([item("a"), item("a")]) ?? "", /used twice/);
  assert.match(failure([{ type: "separator" }]) ?? "", /no item/);
  assert.match(
    failure(
      Array.from({ length: bridgeLimits.maxMenuEntries + 1 }, (_, i) =>
        item(`i${i}`),
      ),
    ) ?? "",
    /limit is 200/,
  );
  assert.ok(failure([{ ...item("a"), icon: "No Such Icon!" }]));

  const pick = (params: unknown) =>
    validateBridgeRequest(request("ui.pick", params), page);
  const items = [item("a"), item("b")];
  assert.equal(
    pick({ ariaLabel: "Pick", mode: "multiple", items, selected: ["a", "b"] })
      .ok,
    true,
  );
  assert.equal(
    pick({ ariaLabel: "Pick", mode: "single", items, selected: ["a", "b"] }).ok,
    false,
  );
  assert.equal(
    pick({ ariaLabel: "Pick", mode: "single", items: [item("a"), item("a")] })
      .ok,
    false,
  );
  assert.equal(
    pick({
      ariaLabel: "Pick",
      mode: "single",
      items: Array.from({ length: bridgeLimits.maxPickItems + 1 }, (_, i) =>
        item(`i${i}`),
      ),
    }).ok,
    false,
  );
});
