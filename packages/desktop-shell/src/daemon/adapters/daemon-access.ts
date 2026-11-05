import {
  type DeviceGrant,
  type PairingCode,
  type PairingPurpose,
} from "@nervekit/contracts/access";
import { DaemonAccessError, type DaemonAccessPort } from "../ports.js";

const REQUEST_TIMEOUT_MS = 10_000;

/** `/api/access/*` calls the shell makes outside the renderer. */
export function createDaemonAccessClient(
  request: typeof fetch = fetch,
): DaemonAccessPort {
  async function call<T>(
    url: string,
    path: string,
    body: unknown,
    bearer?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await request(new URL(path, url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new DaemonAccessError(
        undefined,
        undefined,
        `Could not reach the Nerve daemon at ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) throw await accessError(response);
    return (await response.json()) as T;
  }

  return {
    createPairingCode: (url, bearer, purpose: PairingPurpose) =>
      call<PairingCode>(url, "/api/access/pairing-codes", { purpose }, bearer),
    redeemPairingCode: async (url, input) => {
      const grant = await call<DeviceGrant>(url, "/api/access/pair", {
        code: input.code,
        deviceName: input.deviceName,
        kind: "desktop",
        delivery: "bearer",
      });
      if (!grant.credential) {
        throw new DaemonAccessError(
          200,
          undefined,
          "The daemon did not return a device credential.",
        );
      }
      return grant.credential;
    },
  };
}

async function accessError(response: Response): Promise<DaemonAccessError> {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; message?: unknown };
    };
    if (typeof body.error?.code === "string") code = body.error.code;
    if (typeof body.error?.message === "string") message = body.error.message;
  } catch {
    // Non-JSON error body; fall back to the status line.
  }
  const retryAfter = response.headers.get("retry-after");
  const suffix =
    code === "RATE_LIMITED" && retryAfter
      ? ` Try again in ${retryAfter} seconds.`
      : "";
  return new DaemonAccessError(
    response.status,
    code,
    `${message ?? `Request failed with status ${response.status}.`}${suffix}`,
  );
}
