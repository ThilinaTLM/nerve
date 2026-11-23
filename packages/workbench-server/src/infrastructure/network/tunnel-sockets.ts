import type { Server } from "node:net";
import type { Socket } from "node:net";

/*
 * Sockets accepted by the private tunnel listener. Whether a request came
 * through the tunnel is decided here, from the listening socket, so no header
 * can claim it.
 */
const tunnelSockets = new WeakSet<Socket>();

export function markTunnelListener(server: Server): void {
  server.on("connection", (socket: Socket) => tunnelSockets.add(socket));
}

export function isTunnelSocket(socket: unknown): boolean {
  return typeof socket === "object" && socket !== null
    ? tunnelSockets.has(socket as Socket)
    : false;
}
