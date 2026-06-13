import { readDaemonConnection } from "../daemon/connection.js";
import { openUrl } from "../daemon/open-url.js";

export async function commandUi(args: string[]): Promise<void> {
  const connection = await readDaemonConnection();
  console.log(connection.url);
  if (args.includes("--open")) openUrl(connection.url);
}
