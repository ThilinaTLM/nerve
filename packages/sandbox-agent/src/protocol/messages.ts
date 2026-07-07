import {
  type SandboxProtocolMessage,
  sandboxProtocolMessageSchema,
} from "@nervekit/shared";

export type { SandboxProtocolMessage };

export function encodeMessage(message: SandboxProtocolMessage): string {
  return JSON.stringify(sandboxProtocolMessageSchema.parse(message));
}
export function decodeMessage(data: string | Buffer): SandboxProtocolMessage {
  return sandboxProtocolMessageSchema.parse(JSON.parse(String(data)));
}
