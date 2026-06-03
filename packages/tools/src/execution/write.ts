import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { writeTextFileAtomically } from "./atomic-write.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { resolveToolPath } from "./path.js";

export async function executeWrite(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = resolveToolPath(context.cwd, args.path);
  if (typeof args.content !== "string")
    throw new Error("Tool argument 'content' must be a string.");
  return withFileMutationQueue(path, async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeTextFileAtomically(path, args.content as string);
    const content = `Wrote ${Buffer.byteLength(args.content as string, "utf8")} bytes.`;
    return {
      path,
      content,
      contentBlocks: [{ type: "text", text: content }],
    };
  });
}
