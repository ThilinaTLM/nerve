export type ConnectedSandboxSession = {
  sandboxId: string;
  sessionId: string;
  connectedAt: string;
  socket: { send(data: string): void; close(): void };
};
