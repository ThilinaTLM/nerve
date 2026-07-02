export type SandboxProtocolMessage =
  | {
      type: "hello";
      role: "agent";
      instanceId: string;
      capabilities: string[];
      resume?: unknown;
    }
  | { type: "welcome"; sessionId: string; accepted: true }
  | { type: "ready"; instanceId: string }
  | { type: "heartbeat"; ts: string }
  | { type: "ack"; stream: string; processedSeq: number }
  | { type: "event.batch"; batchId: string; events: unknown[] }
  | { type: "request"; id: string; method: string; params: unknown }
  | { type: "response"; id: string; result: unknown }
  | { type: "error"; id?: string; error: { code: string; message: string } }
  | { type: "goodbye"; reason?: string };
export function encodeMessage(message: SandboxProtocolMessage): string {
  return JSON.stringify(message);
}
export function decodeMessage(data: string | Buffer): SandboxProtocolMessage {
  return JSON.parse(String(data)) as SandboxProtocolMessage;
}
