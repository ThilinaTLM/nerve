import type { IncomingMessage } from "node:http";
import type { ManagerState } from "../app/manager-state.js";
export class SandboxWsServer {
  constructor(private readonly state: ManagerState) {}
  handleUpgrade(_req: IncomingMessage): void {
    void this.state;
    throw new Error(
      "WebSocket upgrade requires a ws-compatible adapter; HTTP APIs remain available",
    );
  }
}
