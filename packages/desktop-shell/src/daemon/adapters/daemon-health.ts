import type { DaemonHealthCheckResult } from "../ports.js";

const HEALTH_CHECK_TIMEOUT_MS = 1500;

export async function checkHealth(
  daemonUrl: string,
  token: string,
  options: {
    fetch?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
  } = {},
): Promise<DaemonHealthCheckResult> {
  const now = options.now ?? Date.now;
  const request = options.fetch ?? fetch;
  const startedAt = now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? HEALTH_CHECK_TIMEOUT_MS,
  );
  try {
    const response = await request(new URL("/api/health", daemonUrl), {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const durationMs = now() - startedAt;
    return response.ok
      ? { healthy: true, outcome: "ok", durationMs, status: response.status }
      : {
          healthy: false,
          outcome: "http_error",
          durationMs,
          status: response.status,
        };
  } catch (error) {
    return {
      healthy: false,
      outcome: controller.signal.aborted ? "timeout" : "network_error",
      durationMs: now() - startedAt,
      error: (error instanceof Error ? error.message : String(error)).slice(
        0,
        512,
      ),
    };
  } finally {
    clearTimeout(timeout);
  }
}
