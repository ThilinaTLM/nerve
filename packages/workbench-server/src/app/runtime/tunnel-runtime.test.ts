import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
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

  void it("closes even with an upgraded socket open, and cuts it off", async () => {
    // A WebSocket client outlives server.close() unless the socket is destroyed.
    const listener = await openTunnelListener(undefined, (port) => {
      const server = probe(port);
      server.on("upgrade", (_request, socket) =>
        socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n"),
      );
      return server;
    });
    const client = connect(listener.port, "127.0.0.1");
    const upgraded = new Promise((resolve) => client.once("data", resolve));
    client.write(
      "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    await upgraded;
    const ended = new Promise((resolve) => client.once("close", resolve));
    await Promise.race([
      listener.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("close() hung")), 2_000),
      ),
    ]);
    await ended;
  });

  void it("attaches only once listening and detaches on close", async () => {
    const calls: string[] = [];
    // A failed first attempt (port taken) never attaches.
    const taken = probe(0);
    await new Promise((resolve) => taken.once("listening", resolve));
    const busy = (taken.address() as AddressInfo).port;
    const fallback = await openTunnelListener(busy, probe, () => {
      calls.push("fallback");
      return () => undefined;
    });
    assert.deepEqual(calls, ["fallback"]);
    await fallback.close();
    await new Promise((resolve) => taken.close(resolve));
    calls.length = 0;

    const listener = await openTunnelListener(undefined, probe, () => {
      calls.push("attach");
      return () => void calls.push("detach");
    });
    assert.deepEqual(calls, ["attach"]);
    await listener.close();
    assert.deepEqual(calls, ["attach", "detach"]);
  });
});
