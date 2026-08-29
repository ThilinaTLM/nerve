export interface DomainEventIntent<
  TName extends string = string,
  TData = unknown,
> {
  readonly type: TName;
  readonly data: TData;
  readonly delivery: "sequenced" | "ephemeral";
  readonly occurredAt: string;
}

export interface DomainEventPublisherPort {
  publish(event: DomainEventIntent): Promise<void>;
}
