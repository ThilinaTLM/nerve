import { readdir, stat } from "node:fs/promises";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { numberArg } from "./common.js";
import { resolveToolPath } from "./path.js";
import { truncateHead } from "./truncate.js";

export async function executeLs(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const root = resolveToolPath(context.cwd, args.path ?? ".");
  const info = await stat(root);
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
  const truncated = truncateHead(content, {
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  content = truncated.text;
  return {
    path: root,
    entries,
    content,
    contentBlocks: [{ type: "text", text: content }],
    details: truncated.truncated ? { truncation: truncated } : undefined,
  };
}
