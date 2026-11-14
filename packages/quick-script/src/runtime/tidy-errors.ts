import { ToolExecutionError } from "@nervekit/tools/execution";
import type { SdkMethod } from "./sdk-types.js";

/** `JIRA_BAD_REQUEST: Jira POST /issue/X/worklog failed (400 Bad Request): reason` (same for Confluence). */
const REQUEST_FAILURE =
  /^(?:JIRA|CONFLUENCE)_[A-Z_]+: (?:Jira|Confluence) [A-Z]+ \S+ failed \((\d+)[^)]*\)(?::\s*([\s\S]*?))?\s*$/;

const BAD_TIME = /time ?logged|time duration|worklog must not be null/i;
const BAD_TIME_HINT =
  'time must look like "1h 30m" (units w, d, h, m; e.g. "2d", "45m").';

/** The name an error is about: `issue SCRUM-9` is `SCRUM-9`; generic resources get no prefix. */
function subject(resource: string): string | undefined {
  if (!resource || /^(this )?(Jira|Confluence)\b|^space /.test(resource))
    return undefined;
  return resource.replace(/^issue /, "");
}

/**
 * Jira and Confluence failures read `SCRUM-9: <Jira's message>` instead of the transport
 * text with method, path and status; the error code is kept.
 */
function tidy(error: unknown, resource: string, path: string): unknown {
  if (!(error instanceof ToolExecutionError)) return error;
  const match = REQUEST_FAILURE.exec(error.message);
  if (!match) return error;
  const reason = match[2]?.trim();
  const message =
    path.startsWith("worklogs.") && reason && BAD_TIME.test(reason)
      ? BAD_TIME_HINT
      : reason || `HTTP ${match[1]}`;
  const prefix = subject(resource);
  return new ToolExecutionError(
    error.code,
    prefix ? `${prefix}: ${message}` : message,
    error.details,
    error.retryable,
  );
}

/** Wraps a method so its Atlassian failures carry the tidy message (the raw `request` keeps the full one). */
export function withTidyErrors(method: SdkMethod): SdkMethod {
  if (method.path === "request") return method;
  return {
    ...method,
    prepare(args, env) {
      const prepared = method.prepare(args, env);
      return {
        ...prepared,
        run: async (runEnv) => {
          try {
            return await prepared.run(runEnv);
          } catch (error) {
            throw tidy(error, prepared.resource, method.path);
          }
        },
      };
    },
  };
}
