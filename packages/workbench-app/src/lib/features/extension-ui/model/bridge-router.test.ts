import assert from "node:assert/strict";
import test from "node:test";
import { bridgeLimits } from "@nervekit/contracts/extensions";
import {
  errorResponse,
  eventMessage,
  failureOf,
  routeFrameMessage,
} from "./bridge-router";

const preview = { kind: "preview", id: "grid", edit: "source" } as const;
const custom = { kind: "preview", id: "grid", edit: "custom" } as const;
const page = { kind: "page", id: "home" } as const;
const request = (method: string, params?: unknown, id = "1") => ({
  nerveBridge: 1,
  type: "request",
  id,
  method,
  params,
});

test("routes the handshake and valid requests to the right handler", () => {
  assert.deepEqual(routeFrameMessage({ nerveBridge: 1, type: "ready" }, page), {
    type: "ready",
  });
  assert.deepEqual(
    routeFrameMessage(request("call", { method: "a.b" }), page),
    {
      type: "request",
      id: "1",
      method: "call",
      params: { method: "a.b" },
      handler: "server",
    },
  );
  const confirm = routeFrameMessage(
    request("ui.confirm", { title: "Sure?" }),
    page,
  );
  assert.equal(confirm.type === "request" && confirm.handler, "host");
  const viewState = routeFrameMessage(request("viewState.get"), page);
  assert.equal(viewState.type === "request" && viewState.handler, "host");
});

test("rejects methods the contribution may not call, and bad params", () => {
  const notAllowed = routeFrameMessage(request("file.read", {}), page);
  assert.equal(
    notAllowed.type === "reject" && notAllowed.error.code,
    "not_allowed",
  );
  const noWrite = routeFrameMessage(
    request("file.write", { content: "x", encoding: "utf8" }),
    preview,
  );
  assert.equal(noWrite.type === "reject" && noWrite.error.code, "not_allowed");
  assert.equal(
    routeFrameMessage(
      request("file.write", { content: "x", encoding: "utf8" }),
      custom,
    ).type,
    "request",
  );
  const invalid = routeFrameMessage(request("openFile", { path: 3 }), page);
  assert.equal(
    invalid.type === "reject" && invalid.error.code,
    "invalid_request",
  );
  const unknown = routeFrameMessage(request("nope"), page);
  assert.equal(
    unknown.type === "reject" && unknown.error.code,
    "unknown_method",
  );
});

test("drops garbage and answers oversized or malformed requests by id", () => {
  assert.equal(routeFrameMessage("hello", page).type, "ignore");
  assert.equal(
    routeFrameMessage({ nerveBridge: 2, type: "ready" }, page).type,
    "ignore",
  );
  const malformed = routeFrameMessage(
    { nerveBridge: 1, type: "request", id: "9", extra: 1 },
    page,
  );
  assert.equal(malformed.type === "reject" && malformed.id, "9");
  const big = routeFrameMessage(
    request(
      "viewState.set",
      { state: "x".repeat(bridgeLimits.maxMessageBytes) },
      "7",
    ),
    page,
  );
  assert.equal(big.type === "reject" && big.error.code, "too_large");
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(routeFrameMessage(circular, page).type, "ignore");
});

test("events respect the kind and their schema", () => {
  const data = { size: 3 };
  assert.equal(
    eventMessage("fileChanged", data, "preview")?.event,
    "fileChanged",
  );
  assert.equal(eventMessage("fileChanged", data, "page"), undefined);
  assert.equal(
    eventMessage("modeChanged", { mode: "edit" }, "preview")?.type,
    "event",
  );
  assert.equal(
    eventMessage("modeChanged", { mode: "x" }, "preview"),
    undefined,
  );
  assert.equal(
    eventMessage("themeChanged", { kind: "dark", tokensCss: "" }, "panel")
      ?.type,
    "event",
  );
});

test("maps request failures to bridge errors", () => {
  assert.deepEqual(failureOf(new Error("boom"), "call"), {
    code: "backend_error",
    message: "boom",
  });
  assert.deepEqual(failureOf(new Error("boom"), "file.read"), {
    code: "failed",
    message: "boom",
  });
  assert.equal(
    failureOf(Object.assign(new Error("x"), { code: "not_found" }), "file.read")
      .code,
    "not_found",
  );
  assert.equal(
    errorResponse("1", "failed", "x".repeat(5000)).error.message.length,
    2000,
  );
});

test("routes frame errors and offers clipboard and store to every kind", () => {
  const error = { kind: "csp", message: "blocked" };
  assert.deepEqual(
    routeFrameMessage({ nerveBridge: 1, type: "frameError", error }, page),
    { type: "frameError", error },
  );
  for (const contribution of [
    preview,
    page,
    { kind: "panel", id: "p" } as const,
  ]) {
    const copy = routeFrameMessage(
      request("clipboard.writeText", { text: "x" }),
      contribution,
    );
    assert.deepEqual(copy.type === "request" && copy.handler, "host");
    const get = routeFrameMessage(
      request("extensionStore.get", { key: "a" }),
      contribution,
    );
    assert.deepEqual(get.type === "request" && get.handler, "server");
  }
});

test("passes conflict errors through", () => {
  assert.equal(
    failureOf({ code: "conflict", message: "stale" }, "extensionStore.set")
      .code,
    "conflict",
  );
});
