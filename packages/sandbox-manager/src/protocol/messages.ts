import type { NerveMessage, ProtocolV1Message } from "@nervekit/contracts";
import { ProtocolCodec } from "@nervekit/protocol";

const codec = new ProtocolCodec();

export type ManagerProtocolMessage = ProtocolV1Message;

export function parseProtocolMessage(data: string | Buffer): ProtocolV1Message {
  return codec.decode(String(data));
}

export function encodeProtocolMessage(message: NerveMessage): string {
  return codec.encode(message as ProtocolV1Message);
}
