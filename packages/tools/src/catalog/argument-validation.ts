import { Value } from "typebox/value";
import type { ToolDefinition } from "./contracts.js";

const MAX_REPORTED_ERRORS = 5;

type SchemaError = {
  keyword?: string;
  instancePath?: string;
  message?: string;
  params?: { requiredProperties?: string[] };
};

function fieldName(path: string | undefined): string {
  return (path ?? "").replace(/^\//, "").replaceAll("/", ".");
}

/**
 * Field-level schema errors for tool arguments, or undefined when they are valid.
 * Example: `edit: missing required "path"; "edits": must have at least 1 item`.
 */
export function describeToolArgumentErrors(
  definition: Pick<ToolDefinition, "name" | "parameters">,
  args: unknown,
): string | undefined {
  if (Value.Check(definition.parameters, args)) return undefined;
  const empty =
    typeof args === "object" && args !== null && Object.keys(args).length === 0;
  const parts: string[] = [];
  for (const error of Value.Errors(
    definition.parameters,
    args,
  ) as SchemaError[]) {
    if (error.keyword === "required") {
      for (const name of error.params?.requiredProperties ?? [])
        parts.push(
          `missing required "${[fieldName(error.instancePath), name].filter(Boolean).join(".")}"`,
        );
    } else {
      const field = fieldName(error.instancePath);
      parts.push(
        field ? `"${field}": ${error.message}` : (error.message ?? "invalid"),
      );
    }
  }
  const shown = parts.slice(0, MAX_REPORTED_ERRORS).join("; ");
  const more =
    parts.length > MAX_REPORTED_ERRORS
      ? ` (+${parts.length - MAX_REPORTED_ERRORS} more)`
      : "";
  const hint = empty
    ? " The tool arguments were empty; the model may have sent no arguments or they could not be parsed."
    : "";
  return `${definition.name}: ${shown || "invalid arguments"}${more}.${hint}`;
}
