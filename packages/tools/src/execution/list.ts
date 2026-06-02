import { readdir } from "node:fs/promises";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { numberArg } from "./common.js";
import { resolveToolPath } from "./path.js";

export async function executeLs(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const root = resolveToolPath(context.cwd, args.path ?? ".");
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
  return { path: root, entries };
}
