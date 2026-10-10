import type { NerveMessage, ProtocolV1Message } from "@nervekit/contracts/wire";
import type { MessageFactory } from "../messages/message-factory.js";
import type { RpcClient } from "../rpc/rpc-client.js";
import type { RpcDispatcher } from "../rpc/rpc-server.js";
import { ProtocolDecodeError } from "../transports/codec.js";

/** Encoding failures belong to the request, not the session. */
export async function sendRpcResponse(
  response: NerveMessage,
  send: (message: NerveMessage) => void | Promise<void>,
  createMessage: MessageFactory,
): Promise<void> {
  try {
    await send(response);
  } catch (error) {
    if (
      !(error instanceof ProtocolDecodeError) ||
      error.code !== "MESSAGE_TOO_LARGE"
    )
      throw error;
    await send(
      createMessage(
        "error",
        {
          code: "MESSAGE_TOO_LARGE",
          message: "RPC reply exceeds the configured byte limit",
          retryable: false,
        },
        {
          target: response.target,
          replyTo: response.replyTo,
          correlationId: response.correlationId,
        },
      ),
    );
  }
}

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
