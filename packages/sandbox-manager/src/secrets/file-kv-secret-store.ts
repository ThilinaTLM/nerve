import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  KvSecretStore,
  ManagerSecretResolveRequest,
  ManagerSecretResolveResponse,
} from "./kv-secret-store.js";
export class FileKvSecretStore implements KvSecretStore {
  constructor(private readonly rootDir: string) {}
  async set(
    key: string,
    value: string,
    metadata: Omit<ManagerSecretResolveResponse, "value"> = {},
  ): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const file = path.join(this.rootDir, `${safe(key)}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(
      tmp,
      `${JSON.stringify({ ...metadata, value }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(tmp, file);
  }
  async resolve(
    request: ManagerSecretResolveRequest,
  ): Promise<ManagerSecretResolveResponse> {
    const raw = await readFile(
      path.join(this.rootDir, `${safe(request.key)}.json`),
      "utf8",
    );
    const value = JSON.parse(raw) as ManagerSecretResolveResponse;
    if (request.version && value.version && request.version !== value.version)
      throw new Error("Secret version not found");
    return value;
  }
}
function safe(key: string): string {
  return Buffer.from(key).toString("base64url");
}
