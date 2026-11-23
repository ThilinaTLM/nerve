import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { isTunnelSocket } from "../../infrastructure/network/tunnel-sockets.js";
import { openTunnelListener } from "./tunnel-runtime.js";

/** Answers whether the request's socket counts as a tunnel socket. */
function probe(port: number): Server {
  return createServer((request, response) =>
    response.end(String(isTunnelSocket(request.socket))),
  ).listen(port, "127.0.0.1");
}

void describe("openTunnelListener", () => {
  void it("marks every socket it accepts as a tunnel socket", async () => {
    const listener = await openTunnelListener(undefined, probe);
    const other = probe(0);
    await new Promise((resolve) => other.once("listening", resolve));
    try {
      const viaTunnel = await fetch(`http://127.0.0.1:${listener.port}/`);
      assert.equal(await viaTunnel.text(), "true");
      const direct = await fetch(
        `http://127.0.0.1:${(other.address() as AddressInfo).port}/`,
      );
      assert.equal(await direct.text(), "false");
    } finally {
      await listener.close();
      await new Promise((resolve) => other.close(resolve));
    }
  });

  void it("falls back to a free port when the saved one is taken", async () => {
    const taken = probe(0);
    await new Promise((resolve) => taken.once("listening", resolve));
    const busy = (taken.address() as AddressInfo).port;
    const listener = await openTunnelListener(busy, probe);
    try {
      assert.notEqual(listener.port, busy);
    } finally {
      await listener.close();
      await new Promise((resolve) => taken.close(resolve));
    }
  });
});
