import assert from "node:assert/strict";
import { test } from "node:test";
import { protocolSocketUrl } from "./protocol-socket-url";

const daemon = "ws://127.0.0.1:43967/ws";

test("a page on a default port does not keep the daemon's port", () => {
  assert.equal(
    protocolSocketUrl(daemon, "/ws/workbench", {
      protocol: "https:",
      host: "pc.tail1234.ts.net",
    }),
    "wss://pc.tail1234.ts.net/ws/workbench",
  );
});

test("a page with an explicit port connects to that port", () => {
  assert.equal(
    protocolSocketUrl(daemon, "/ws/conversations", {
      protocol: "http:",
      host: "192.168.1.5:3747",
    }),
    "ws://192.168.1.5:3747/ws/conversations",
  );
});

test("outside a web page the daemon's address is used", () => {
  assert.equal(
    protocolSocketUrl(daemon, "/ws/workbench", { protocol: "file:", host: "" }),
    "ws://127.0.0.1:43967/ws/workbench",
  );
});
