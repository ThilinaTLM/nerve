import type { Context } from "hono";
import type { ApplicationLogger } from "../infrastructure/diagnostics/index.js";

interface RequestContext {
  requestId: string;
  logger: ApplicationLogger;
}

const contexts = new WeakMap<Request, RequestContext>();

export function setRequestContext(
  request: Request,
  context: RequestContext,
): void {
  contexts.set(request, context);
}

export function clearRequestContext(request: Request): void {
  contexts.delete(request);
}

export function requestContextFor(c: Context): RequestContext | undefined {
  return contexts.get(c.req.raw);
}
