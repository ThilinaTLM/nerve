import {
  type SandboxProtocolMessage,
  sandboxProtocolMessageSchema,
} from "@nervekit/shared";

export type ManagerProtocolMessage = SandboxProtocolMessage;

export function parseProtocolMessage(
  data: string | Buffer,
): ManagerProtocolMessage {
  return sandboxProtocolMessageSchema.parse(JSON.parse(String(data)));
}

export function encodeProtocolMessage(message: SandboxProtocolMessage): string {
  return JSON.stringify(sandboxProtocolMessageSchema.parse(message));
}
