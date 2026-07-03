import type { WebSocket } from "ws";
import type { CommandForwarder } from "./command-forwarder.js";

export type ConnectedSandboxSession = {
  sandboxId: string;
  instanceId: string;
  sessionId: string;
  connectedAt: string;
  lastHeartbeatAt?: string;
  socket: WebSocket;
  forwarder: CommandForwarder;
};

export class SandboxSessionRegistry {
  private readonly sessions = new Map<string, ConnectedSandboxSession>();

  set(session: ConnectedSandboxSession): void {
    this.sessions.get(session.sandboxId)?.socket.close(1012, "replaced");
    this.sessions.set(session.sandboxId, session);
  }

  get(sandboxId: string): ConnectedSandboxSession | undefined {
    return this.sessions.get(sandboxId);
  }

  delete(sandboxId: string, sessionId?: string): boolean {
    const current = this.sessions.get(sandboxId);
    if (!current) return false;
    if (sessionId && current.sessionId !== sessionId) return false;
    this.sessions.delete(sandboxId);
    return true;
  }

  list(): ConnectedSandboxSession[] {
    return Array.from(this.sessions.values());
  }
}
