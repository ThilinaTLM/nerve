import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Server, Socket } from "node:net";
import { describe, it } from "node:test";
import { gateRequestFromUpgrade } from "../../../src/adapters/http/gate-request.js";
import { markTunnelListener } from "../../../src/infrastructure/network/tunnel-sockets.js";

function upgrade(socket: Socket): IncomingMessage {
  return {
    method: "GET",
    url: "/ws/workbench",
    headers: { host: "pc.ts.net" },
    socket,
  } as unknown as IncomingMessage;
}

describe("gateRequestFromUpgrade", () => {
  it("marks only sockets accepted by the tunnel listener", () => {
    const tunnel = new EventEmitter();
    markTunnelListener(tunnel as unknown as Server);
    const marked = { remoteAddress: "127.0.0.1" } as Socket;
    tunnel.emit("connection", marked);
    const plain = { remoteAddress: "127.0.0.1" } as Socket;
    assert.equal(gateRequestFromUpgrade(upgrade(marked)).viaTunnel, true);
    assert.equal(gateRequestFromUpgrade(upgrade(plain)).viaTunnel, false);
  });
});
