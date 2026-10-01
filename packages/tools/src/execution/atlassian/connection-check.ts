import { confluenceRequest, normalizeSiteUrl } from "../confluence/client.js";
import { trimTrailingSlashes } from "./site-url.js";
import { jiraRequest } from "../jira/client.js";
import { ToolExecutionError } from "../errors/tool-error.js";

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

/**
 * Probe one Atlassian service with the cheapest authenticated endpoint. The
 * result separates refused credentials from missing access and from transient
 * failures, so callers never report a network blip as an invalid token.
 */
export async function checkAtlassianConnection(
  connection: { siteUrl: string; email: string; token: string },
  service: AtlassianCheckService,
  signal?: AbortSignal,
): Promise<AtlassianConnectionCheck> {
  const timeout = AbortSignal.timeout(CHECK_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    if (service === "jira") {
      await jiraRequest(
        {
          siteUrl: trimTrailingSlashes(connection.siteUrl.trim()),
          email: connection.email.trim(),
          token: connection.token,
        },
        { path: "/myself", signal: combined },
      );
    } else {
      await confluenceRequest(
        {
          siteUrl: normalizeSiteUrl(connection.siteUrl),
          email: connection.email.trim(),
          token: connection.token,
        },
        // The current-user endpoint exists only in the v1 REST API.
        { api: "v1", path: "/user/current", signal: combined },
      );
    }
    return { status: "verified" };
  } catch (error) {
    if (error instanceof ToolExecutionError) {
      return {
        status: atlassianStatusForErrorCode(error.code) ?? "unreachable",
        message: error.message,
      };
    }
    return {
      status: "unreachable",
      message:
        error instanceof Error && error.name === "TimeoutError"
          ? `${service === "jira" ? "Jira" : "Confluence"} did not respond in time.`
          : `Could not reach ${service === "jira" ? "Jira" : "Confluence"}.`,
    };
  }
}

/**
 * Map a Jira/Confluence tool error code to connection evidence. Only codes
 * that say something about the credentials or the site are mapped; transient
 * and request-specific failures return undefined.
 */
export function atlassianStatusForErrorCode(
  code: string,
): AtlassianConnectionStatus | undefined {
  if (code === "JIRA_UNAUTHORIZED" || code === "CONFLUENCE_UNAUTHORIZED")
    return "rejected";
  if (code === "JIRA_FORBIDDEN" || code === "CONFLUENCE_FORBIDDEN")
    return "restricted";
  if (code === "JIRA_NOT_FOUND" || code === "CONFLUENCE_NOT_FOUND")
    return "unavailable";
  return undefined;
}
