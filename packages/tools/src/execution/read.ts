import { readFile } from "node:fs/promises";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { numberArg } from "./common.js";
import { resolveToolPath } from "./path.js";

export async function executeRead(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = resolveToolPath(context.cwd, args.path);
  const content = await readFile(path, "utf8");
  const lines = content.split(/\r?\n/);
  const offset = numberArg(args.offset, 1);
  const limit = Math.min(numberArg(args.limit, 1000), 5000);
  const selected = lines
    .slice(Math.max(0, offset - 1), Math.max(0, offset - 1) + limit)
    .join("\n");
  const remaining = Math.max(0, lines.length - (offset - 1 + limit));
  return {
    path,
    content:
      remaining > 0
        ? `${selected}\n\n[...${remaining} more lines. Continue with offset ${offset + limit}.]`
        : selected,
  };
}
