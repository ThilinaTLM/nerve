export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "ERROR",
  ) {
    super(message);
    this.name = "HttpError";
  }
}
export function errorResponse(error: unknown): {
  status: number;
  body: { error: { code: string; message: string } };
} {
  if (error instanceof HttpError)
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message } },
    };
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL",
        message: error instanceof Error ? error.message : String(error),
      },
    },
  };
}
