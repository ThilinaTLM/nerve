import { basename } from "node:path";
import { optionalString } from "../atlassian/arguments.js";
import { ToolExecutionError } from "../errors/tool-error.js";

export function estimateQuery(
  args: Record<string, unknown>,
): Record<string, string | undefined> {
  return {
    adjustEstimate: optionalString(args.adjust_estimate),
    newEstimate: optionalString(args.new_estimate),
    increaseBy: optionalString(args.increase_by),
  };
}

export function safeFilename(value: string): string {
  const name = [...basename(value)]
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
        ? "_"
        : character,
    )
    .join("")
    .trim();
  if (!name || name === "." || name === "..")
    throw new ToolExecutionError(
      "JIRA_INVALID_FILENAME",
      "Attachment filename is invalid.",
    );
  return name.slice(0, 240);
}

export function past(action: string): string {
  if (action === "create") return "Created";
  if (action === "update") return "Updated";
  if (action === "delete") return "Deleted";
  if (action === "start") return "Started";
  if (action === "close") return "Closed";
  return `${action}d`;
}
