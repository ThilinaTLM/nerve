import { GitWorkflowError } from "@nervekit/host-runtime/tools";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly options: {
      retryable?: boolean;
      recovery?: { action: string; retryAfterMs?: number; method?: string };
    } = {},
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError || error instanceof GitWorkflowError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable:
            error instanceof HttpError ? error.options.retryable : undefined,
          recovery:
            error instanceof HttpError ? error.options.recovery : undefined,
        },
      },
      { status: error.status },
    );
  }
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    },
    { status: 500 },
  );
}
