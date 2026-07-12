export * from "./git-mutation-publisher.js";
export * from "./run-coordinator.js";
export * from "./run-unit-of-work.js";
export * from "./task-service.js";

export interface ClockPort {
  now(): Date;
}

export interface IdPort {
  next(): string;
}

export interface DiagnosticPort {
  debug(message: string, data?: Readonly<Record<string, unknown>>): void;
  warn(message: string, data?: Readonly<Record<string, unknown>>): void;
  error(message: string, data?: Readonly<Record<string, unknown>>): void;
}

export interface DomainEventIntent<
  TName extends string = string,
  TData = unknown,
> {
  readonly type: TName;
  readonly data: TData;
  readonly durability: "durable" | "transient";
  readonly occurredAt: string;
}

export interface DomainEventPublisherPort {
  publish(event: DomainEventIntent): Promise<void>;
}
