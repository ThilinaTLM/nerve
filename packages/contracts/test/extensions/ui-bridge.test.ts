import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
    bridgeRequestSchema.safeParse({ type: "request", id: "1", method: "call" })
      .success,
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
  assert.equal(
    isBridgeMethodAllowed("mode.get", { kind: "preview", edit: "custom" }),
    true,
  );
  assert.equal(isBridgeMethodAllowed("call", { kind: "panel" }), true);
  assert.equal(bridgeMethodNames.length, 15);
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
      request("call", { method: "csv.sum", args: { a: 1 } }),
      page,
    ).ok,
    true,
  );
  const bad = validateBridgeRequest(
    request("openPage", { id: "Bad Id" }),
    page,
  );
  assert.equal(!bad.ok && bad.error.code, "invalid_request");
  const big = validateBridgeRequest(
    request("viewState.set", {
      state: "x".repeat(bridgeLimits.maxViewStateBytes),
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
