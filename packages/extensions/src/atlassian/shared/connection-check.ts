import type {
  AccountInfo,
  AccountTestResult,
  ExtensionContext,
} from "@nervekit/extension-api";
import { ExtensionError } from "@nervekit/extension-api";
import { confluenceRequest } from "../confluence/client.js";
import { jiraRequest } from "../jira/client.js";
import { confluenceConnection, jiraConnection } from "./session.js";

export type AtlassianCheckService = "jira" | "confluence";

export type AtlassianConnectionStatus =
  | "verified"
  | "rejected"
  | "restricted"
  | "unavailable"
  | "unreachable";

export type AtlassianConnectionCheck = {
  status: AtlassianConnectionStatus;
  message?: string;
};

const CHECK_TIMEOUT_MS = 15_000;

const SERVICES = [
  { id: "jira", label: "Jira" },
  { id: "confluence", label: "Confluence" },
] as const;

/**
 * Probe one Atlassian service with the cheapest authenticated endpoint, with
 * the account the `ctx` selects. The result separates refused credentials from
 * missing access and from transient failures, so callers never report a
 * network blip as an invalid token.
 */
export async function checkAtlassianConnection(
  ctx: ExtensionContext,
  service: AtlassianCheckService,
): Promise<AtlassianConnectionCheck> {
  try {
    if (service === "jira") {
      await jiraRequest(await jiraConnection(ctx), {
        path: "/myself",
        timeoutMs: CHECK_TIMEOUT_MS,
      });
    } else {
      await confluenceRequest(await confluenceConnection(ctx), {
        // The current-user endpoint exists only in the v1 REST API.
        api: "v1",
        path: "/user/current",
        timeoutMs: CHECK_TIMEOUT_MS,
      });
    }
    return { status: "verified" };
  } catch (error) {
    if (error instanceof ExtensionError) {
      return {
        status: atlassianStatusForErrorCode(error.code) ?? "unreachable",
        message: error.fix ? `${error.message} ${error.fix}` : error.message,
      };
    }
    const label = service === "jira" ? "Jira" : "Confluence";
    return {
      status: "unreachable",
      message:
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
          ? `${label} did not respond in time.`
          : `Could not reach ${label}.`,
    };
  }
}

/**
 * Map a failure's script-visible code to connection evidence. Only codes that
 * say something about the credentials or the site are mapped; transient and
 * request-specific failures return undefined.
 */
export function atlassianStatusForErrorCode(
  code: string,
): AtlassianConnectionStatus | undefined {
  if (code === "UNAUTHORIZED") return "rejected";
  if (code === "FORBIDDEN") return "restricted";
  if (code === "NOT_FOUND") return "unavailable";
  return undefined;
}

const field = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * The account kind's `test` hook. Jira and Confluence are checked together:
 * rejected credentials win, then unreachable; otherwise the account is
 * verified when any service answers, and the message names what is not
 * available.
 */
export async function testAtlassianAccount(
  account: AccountInfo,
  ctx: ExtensionContext,
  check: typeof checkAtlassianConnection = checkAtlassianConnection,
): Promise<AccountTestResult> {
  if (!field(account.fields.siteUrl) || !field(account.fields.email))
    throw new ExtensionError(
      "BAD_REQUEST",
      "Add the site URL and email before testing this account.",
    );
  const results = await Promise.all(
    SERVICES.map(async (service) => ({
      label: service.label,
      outcome: await check(ctx, service.id),
    })),
  );
  const problems = results.filter(
    ({ outcome }) => outcome.status !== "verified",
  );
  const message = problems
    .map(
      ({ label, outcome }) => `${label}: ${outcome.message ?? outcome.status}`,
    )
    .join("\n");
  const has = (status: AtlassianConnectionStatus) =>
    results.some(({ outcome }) => outcome.status === status);
  const status: AtlassianConnectionStatus = has("rejected")
    ? "rejected"
    : has("unreachable")
      ? "unreachable"
      : has("verified")
        ? "verified"
        : (results[0]?.outcome.status ?? "unreachable");
  return status === "verified"
    ? { ok: true, ...(message ? { message } : {}) }
    : { ok: false, message, reason: status };
}
