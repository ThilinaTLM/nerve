import type { IncomingMessage, ServerResponse } from "node:http";
import type { StructuredLogger } from "@nervekit/contracts";

type ErrorResponse = { status: number; body: unknown };

/**
 * Wraps the manager's HTTP handler with per-request structured logging:
 * assigns a `requestId`, times the request, and logs completion (severity by
 * status class) or thrown failures with the normalized status/code. This is the
 * single seam that turns opaque `500`s into actionable, correlated log lines.
 */
export function createLoggedRequestListener(
  logger: StructuredLogger,
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  toErrorResponse: (error: unknown) => ErrorResponse,
  writeJson: (res: ServerResponse, status: number, body: unknown) => void,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const startedAt = Date.now();
    const requestId = `req_${Math.random().toString(16).slice(2, 10)}`;
    const method = req.method ?? "GET";
    const path = (req.url ?? "/").split("?")[0];
    const log = logger.child({ requestId, http: { method, path } });
    try {
      await handle(req, res);
      logHttpCompletion(log, res.statusCode, Date.now() - startedAt);
    } catch (error) {
      const response = toErrorResponse(error);
      writeJson(res, response.status, response.body);
      const code = (response.body as { error?: { code?: string } })?.error
        ?.code;
      log[response.status >= 500 ? "error" : "warn"]("http request failed", {
        status: response.status,
        code,
        durationMs: Date.now() - startedAt,
        err: error,
      });
    }
  };
}

function logHttpCompletion(
  log: StructuredLogger,
  status: number,
  durationMs: number,
): void {
  const context = { status, durationMs };
  if (status >= 500) log.error("http request errored", context);
  else if (status >= 400) log.warn("http request rejected", context);
  else log.debug("http request completed", context);
}
