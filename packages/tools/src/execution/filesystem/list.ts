import { readdir, stat } from "node:fs/promises";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import {
  boundText,
  FILE_OUTPUT_MAX_LINE_CHARS,
  textBoundaryDetails,
  textLimitSnapshot,
} from "../common/output-budget.js";
import {
  isErrnoException,
  pathNotFoundMessage,
  resolveToolPath,
} from "./path.js";

export async function executeLs(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const input =
    typeof args.path === "string" && args.path.trim().length === 0
      ? "."
      : (args.path ?? ".");
  const root = resolveToolPath(context.cwd, input);
  const info = await stat(root).catch((error: unknown) => {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(pathNotFoundMessage("ls", input, root));
    }
    throw error;
  });
  if (!info.isDirectory()) throw new Error("ls path is not a directory.");

  const limit = Math.min(numberArg(args.limit, 500), 5000);
  const dirEntries = await readdir(root, { withFileTypes: true });
  dirEntries.sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  const entries: NonNullable<ToolExecutionResult["entries"]> = [];
  for (const entry of dirEntries.slice(0, limit)) {
    entries.push({
      path: `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      kind: entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : "other",
    });
  }

  let content = entries.map((entry) => entry.path).join("\n");
  if (dirEntries.length > entries.length) {
    content += `${content ? "\n\n" : ""}[...${dirEntries.length - entries.length} more entries. Increase limit to see more.]`;
  }
  const bounded = boundText(content, {
    maxLines: Number.MAX_SAFE_INTEGER,
    maxLineChars: FILE_OUTPUT_MAX_LINE_CHARS,
  });
  content = bounded.text;
  return {
    path: root,
    entries,
    content,
    contentBlocks: [{ type: "text", text: content }],
    details: bounded.truncated
      ? {
          truncation: textBoundaryDetails(bounded),
          outputLimits: { execution: textLimitSnapshot(bounded) },
        }
      : undefined,
  };
}
