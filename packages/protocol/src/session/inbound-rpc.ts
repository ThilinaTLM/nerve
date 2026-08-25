import type { NerveMessage, ProtocolV1Message } from "@nervekit/contracts";
import type { MessageFactory } from "../core/messages.js";
import type { RpcClient, RpcDispatcher } from "../rpc/rpc.js";

export function handleInboundRpcResponse(
  rpc: RpcClient,
  message: NerveMessage,
): boolean {
  return rpc.handle(message);
}

export async function dispatchInboundRpc(
  message: ProtocolV1Message & { kind: "request" },
  dispatcher: RpcDispatcher,
  createMessage: MessageFactory,
): Promise<NerveMessage> {
  const result = await dispatcher.dispatch(message);
  const envelopeOptions = {
    target: message.source,
    replyTo: message.id,
    correlationId: message.id,
  };
  return result.ok
    ? createMessage(
        "response",
        { ok: true, method: message.data.method, result: result.result },
        envelopeOptions,
      )
    : createMessage("error", result.error, envelopeOptions);
}
