import { ToolExecutionError } from "../errors/tool-error.js";

/** What a script sees as `HostError.code`; every host failure has one of these. */
export const HOST_ERROR_CODES = [
  "BAD_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "FORBIDDEN",
  "DENIED",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "SERVER_ERROR",
] as const;

export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

const isHostErrorCode = (code: string): code is HostErrorCode =>
  (HOST_ERROR_CODES as readonly string[]).includes(code);

/** An error whose `code` reaches the script unchanged as `e.code`. */
export function codedError(
  code: HostErrorCode,
  message: string,
): ToolExecutionError {
  return new ToolExecutionError(code, message);
}

/**
 * Maps any failure to the script-visible code. Product codes
 * (`JIRA_TRANSITION_NOT_FOUND`) collapse by suffix; NESTED_* policy refusals
 * are `DENIED`; plain errors (validation, prepare, unknown method) are
 * `BAD_REQUEST`.
 */
export function hostErrorCode(error: unknown): HostErrorCode {
  if (!(error instanceof ToolExecutionError)) return "BAD_REQUEST";
  const { code } = error;
  if (isHostErrorCode(code)) return code;
  if (code.startsWith("NESTED_")) return "DENIED";
  const product = /^(?:JIRA|CONFLUENCE)_([A-Z_]+)$/.exec(code)?.[1];
  if (!product) return "BAD_REQUEST";
  if (product.endsWith("NOT_FOUND")) return "NOT_FOUND";
  if (product.endsWith("CONFLICT")) return "CONFLICT";
  if (product === "FORBIDDEN") return "FORBIDDEN";
  if (product === "RATE_LIMITED") return "RATE_LIMITED";
  if (product === "UNAUTHORIZED") return "UNAUTHORIZED";
  if (product === "SERVER_ERROR" || product === "API_ERROR")
    return "SERVER_ERROR";
  return "BAD_REQUEST";
}

/**
 * A product that is disabled or lacks an account is absent from the SDK: its
 * `*_NOT_CONFIGURED` failure names the setting to fix instead of the direct tool's.
 */
export async function orNotAvailable<T>(
  product: "jira" | "confluence",
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (
      error instanceof ToolExecutionError &&
      error.code.endsWith("_NOT_CONFIGURED")
    ) {
      const name = product === "jira" ? "Jira" : "Confluence";
      throw new ToolExecutionError(
        error.code,
        `${product}: not available in quick_script. Ask the user to enable ${name} and choose an Atlassian account with a saved API token in Settings → Tools → quick_script.`,
        error.details,
      );
    }
    throw error;
  }
}
