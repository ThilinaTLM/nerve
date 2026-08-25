import type {
  AgentHarnessStreamOptions,
  AgentHarnessStreamOptionsPatch,
} from "./options.js";

export function cloneStreamOptions(
  streamOptions?: AgentHarnessStreamOptions,
): AgentHarnessStreamOptions {
  return {
    ...streamOptions,
    headers: streamOptions?.headers ? { ...streamOptions.headers } : undefined,
    metadata: streamOptions?.metadata
      ? { ...streamOptions.metadata }
      : undefined,
    env: streamOptions?.env ? { ...streamOptions.env } : undefined,
  };
}

export function mergeHeaders(
  ...headers: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  let hasHeaders = false;
  for (const entry of headers) {
    if (!entry) continue;
    Object.assign(merged, entry);
    hasHeaders = true;
  }
  return hasHeaders ? merged : undefined;
}

export function applyStreamOptionsPatch(
  base: AgentHarnessStreamOptions,
  patch?: AgentHarnessStreamOptionsPatch,
): AgentHarnessStreamOptions {
  const result = cloneStreamOptions(base);
  if (!patch) return result;

  if (Object.hasOwn(patch, "transport")) result.transport = patch.transport;
  if (Object.hasOwn(patch, "timeoutMs")) result.timeoutMs = patch.timeoutMs;
  if (Object.hasOwn(patch, "maxRetries")) result.maxRetries = patch.maxRetries;
  if (Object.hasOwn(patch, "maxRetryDelayMs"))
    result.maxRetryDelayMs = patch.maxRetryDelayMs;
  if (Object.hasOwn(patch, "cacheRetention"))
    result.cacheRetention = patch.cacheRetention;

  if (Object.hasOwn(patch, "headers")) {
    if (patch.headers === undefined) {
      result.headers = undefined;
    } else {
      const headers = { ...(result.headers ?? {}) };
      for (const [key, value] of Object.entries(patch.headers)) {
        if (value === undefined) delete headers[key];
        else headers[key] = value;
      }
      result.headers = Object.keys(headers).length > 0 ? headers : undefined;
    }
  }

  if (Object.hasOwn(patch, "metadata")) {
    if (patch.metadata === undefined) {
      result.metadata = undefined;
    } else {
      const metadata = { ...(result.metadata ?? {}) };
      for (const [key, value] of Object.entries(patch.metadata)) {
        if (value === undefined) delete metadata[key];
        else metadata[key] = value;
      }
      result.metadata = Object.keys(metadata).length > 0 ? metadata : undefined;
    }
  }

  if (Object.hasOwn(patch, "env")) {
    if (patch.env === undefined) {
      result.env = undefined;
    } else {
      const env = { ...(result.env ?? {}) };
      for (const [key, value] of Object.entries(patch.env)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
      result.env = Object.keys(env).length > 0 ? env : undefined;
    }
  }

  return result;
}
