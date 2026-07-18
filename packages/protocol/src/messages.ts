import type {
  NerveMessage,
  PeerDescriptor,
  SafeMetadata,
} from "@nervekit/contracts";
import { createTransportId, type IdFactory } from "./ids.js";

export interface MessageFactoryOptions {
  readonly source: PeerDescriptor;
  readonly target: PeerDescriptor;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceId?: string;
  readonly replyTo?: string;
  readonly meta?: SafeMetadata;
}

export interface MessageFactoryDependencies {
  readonly id?: IdFactory;
  readonly now?: () => Date;
}

export function createMessageFactory(
  defaults: Pick<MessageFactoryOptions, "source" | "target">,
  dependencies: MessageFactoryDependencies = {},
) {
  const id = dependencies.id ?? createTransportId;
  const now = dependencies.now ?? (() => new Date());
  return <TData>(
    kind: string,
    data: TData,
    options: Partial<MessageFactoryOptions> = {},
  ): NerveMessage<TData> => ({
    protocol: "nerve",
    version: 1,
    id: id("msg"),
    kind,
    ts: now().toISOString(),
    source: options.source ?? defaults.source,
    target: options.target ?? defaults.target,
    correlationId: options.correlationId,
    causationId: options.causationId,
    traceId: options.traceId,
    replyTo: options.replyTo,
    meta: options.meta,
    data,
  });
}

export function createClientMessage<TData>(
  kind: string,
  data: TData,
  source: PeerDescriptor,
  target: PeerDescriptor,
  options: Partial<MessageFactoryOptions> = {},
): NerveMessage<TData> {
  return createMessageFactory({ source, target })(kind, data, options);
}

export type MessageFactory = ReturnType<typeof createMessageFactory>;
