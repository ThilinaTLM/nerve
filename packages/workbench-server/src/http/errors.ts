import { GitWorkflowError } from "@nervekit/tools";
import { ApplicationError } from "../core/application-error.js";

/** HTTP-edge validation error. Domain services use ApplicationError directly. */
export class HttpError extends ApplicationError {}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApplicationError || error instanceof GitWorkflowError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable:
            error instanceof ApplicationError
              ? error.options.retryable
              : undefined,
          recovery:
            error instanceof ApplicationError
              ? error.options.recovery
              : undefined,
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
