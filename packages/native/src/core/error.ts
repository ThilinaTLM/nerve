export type NativeErrorCategory =
  | "not_repository"
  | "not_found"
  | "unsupported"
  | "isolation_required"
  | "invalid_input"
  | "io"
  | "corrupt"
  | "limit_exceeded"
  | "cancelled"
  | "internal";

export interface NativeErrorDetail {
  category: NativeErrorCategory;
  message: string;
  retryable: boolean;
}

export class NativeOperationError extends Error {
  readonly category: NativeErrorCategory;
  readonly retryable: boolean;
  constructor(detail: NativeErrorDetail) {
    super(detail.message);
    this.name = "NativeOperationError";
    this.category = detail.category;
    this.retryable = detail.retryable;
  }
}

/** One normalization point for the shared native error envelope. */
export function normalizeNativeError(
  detail: NativeErrorDetail,
): NativeOperationError {
  return new NativeOperationError(detail);
}
