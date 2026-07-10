import {
  createId,
  type NerveMessage,
  type PeerDescriptor,
} from "@nervekit/contracts";

export function createClientMessage<TData>(
  kind: string,
  data: TData,
  source: PeerDescriptor,
  options: Partial<
    Pick<NerveMessage, "correlationId" | "replyTo" | "meta">
  > = {},
): NerveMessage<TData> {
  return {
    protocol: "nerve",
    version: 1,
    id: createId("msg"),
    kind,
    ts: new Date().toISOString(),
    source,
    ...options,
    data,
  };
}
