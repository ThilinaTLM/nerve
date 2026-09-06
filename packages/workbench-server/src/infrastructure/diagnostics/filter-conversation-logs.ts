import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { createInterface } from "node:readline";

/** Called only within the logger's append lane; replacement cannot lose appends. */
export async function filterConversationLogs(
  path: string,
  conversationIds: ReadonlySet<string>,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const output = await open(temporary, "wx", 0o600);
  const input = createReadStream(path, {
    encoding: "utf8",
    highWaterMark: 64 * 1024,
  });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let batch = "";
  let processed = 0;
  try {
    for await (const line of lines) {
      let remove = false;
      try {
        const record: unknown = JSON.parse(line);
        remove =
          typeof record === "object" &&
          record !== null &&
          "conversationId" in record &&
          typeof record.conversationId === "string" &&
          conversationIds.has(record.conversationId);
      } catch {
        // Preserve malformed/unrelated diagnostic data, rather than dropping it.
      }
      if (!remove) batch += `${line}\n`;
      if (batch.length >= 64 * 1024) {
        await output.writeFile(batch);
        batch = "";
      }
      if (++processed % 500 === 0)
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (batch) await output.writeFile(batch);
    await output.sync();
    await output.close();
    await rename(temporary, path);
  } finally {
    lines.close();
    input.destroy();
    await output.close();
    await rm(temporary, { force: true });
  }
}
