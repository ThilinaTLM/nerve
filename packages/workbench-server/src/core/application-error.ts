export type ErrorRecovery = {
  action: string;
  retryAfterMs?: number;
  method?: string;
};

/** Transport-neutral failure raised by application and domain services. */
export class ApplicationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly options: {
      retryable?: boolean;
      recovery?: ErrorRecovery;
    } = {},
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}
