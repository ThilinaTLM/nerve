import { readDaemonConnection } from "../daemon/connection.js";
import { openUrl } from "../daemon/open-url.js";
import { delay } from "../output/prompts.js";

export async function commandServe(args: string[]): Promise<void> {
  if (args.includes("--open")) void openUiWhenReady();
  await import("@nerve/orchestrator/main");
}

async function openUiWhenReady(): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const connection = await readDaemonConnection();
      const response = await fetch(`${connection.url}/api/status`, {
        headers: { authorization: `Bearer ${connection.token}` },
      });
      if (response.ok) {
        openUrl(connection.url);
        return;
      }
    } catch {
      // The daemon may not have written daemon.json yet.
    }
    await delay(200);
  }
  console.error("Timed out waiting to open the Nerve Web UI.");
}
