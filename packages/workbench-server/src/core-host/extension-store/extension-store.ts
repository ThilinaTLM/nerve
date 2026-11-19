import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  bridgeJsonSchema,
  bridgeLimits,
  extensionIdSchema,
  extensionStoreKeySchema,
} from "@nervekit/contracts/extensions";
import type {
  ExtensionStoreErrorCode,
  ExtensionStorePort,
} from "@nervekit/tools/quick-script";
import {
  atomicWriteFile,
  withFileMutation,
} from "../../infrastructure/storage-bootstrap/file-mutations.js";

/** A refused store operation; `code` is what the bridge and the backend map to their own codes. */
export class ExtensionStoreError extends Error {
  constructor(
    readonly code: ExtensionStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExtensionStoreError";
  }
}

/** A key's new state after a write: `revision` `null` means deleted. */
export type ExtensionStoreChange = {
  extensionId: string;
  projectId: string;
  key: string;
  revision: number | null;
  /** The id of the frame request that wrote it; absent for backend writes. */
  origin?: string;
};

export type ExtensionStoreOptions = {
  /** `<data>/extension-store`. */
  root: string;
  projectExists(projectId: string): boolean;
  /** Called after every successful write, outside the lock. Must not throw. */
  onChange?(change: ExtensionStoreChange): void;
};

type Scope = { extensionId: string; projectId: string };
type Stored = { revision: number; updatedAt: string; value: unknown };

const projectIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const fileSuffix = ".json";

/**
 * Durable JSON values per extension and project, shared by the extension's frames and its
 * backend: `<root>/<extension>/<project>/<key>.json` holds `{ revision, updatedAt, value }`.
 * Writes replace the file atomically and run one at a time per extension and project, so
 * revision checks cannot race. Data outlives the extension's installation and the host never
 * migrates it.
 */
export class ExtensionStore {
  readonly #options: ExtensionStoreOptions;

  constructor(options: ExtensionStoreOptions) {
    this.#options = options;
  }

  async get(
    scope: Scope,
    key: string,
  ): Promise<{ value: unknown; revision: number } | undefined> {
    const dir = this.#dir(scope);
    const stored = await readStored(join(dir, fileOf(checkedKey(key))));
    return stored && { value: stored.value, revision: stored.revision };
  }

  async set(
    scope: Scope,
    key: string,
    value: unknown,
    options: {
      ifRevision?: number | undefined;
      origin?: string | undefined;
    } = {},
  ): Promise<{ revision: number }> {
    checkedKey(key);
    const json = serialize(value);
    const dir = this.#dir(scope);
    const revision = await withFileMutation(dir, async () => {
      const file = join(dir, fileOf(key));
      const current = await readStored(file);
      checkRevision(key, current, options.ifRevision);
      await this.#checkRoom(dir, key, json);
      const next = (current?.revision ?? 0) + 1;
      await mkdir(dir, { recursive: true });
      await atomicWriteFile(
        file,
        `{"revision":${next},"updatedAt":${JSON.stringify(new Date().toISOString())},"value":${json}}`,
      );
      return next;
    });
    this.#changed(scope, key, revision, options.origin);
    return { revision };
  }

  async delete(
    scope: Scope,
    key: string,
    options: {
      ifRevision?: number | undefined;
      origin?: string | undefined;
    } = {},
  ): Promise<void> {
    checkedKey(key);
    const dir = this.#dir(scope);
    const removed = await withFileMutation(dir, async () => {
      const file = join(dir, fileOf(key));
      const current = await readStored(file);
      checkRevision(key, current, options.ifRevision);
      if (!current) return false;
      await rm(file, { force: true });
      return true;
    });
    if (removed) this.#changed(scope, key, null, options.origin);
  }

  async keys(
    scope: Scope,
    prefix = "",
  ): Promise<{ key: string; revision: number; size: number }[]> {
    const dir = this.#dir(scope);
    const keys: { key: string; revision: number; size: number }[] = [];
    for (const key of await storedKeys(dir)) {
      if (!key.startsWith(prefix)) continue;
      const stored = await readStored(join(dir, fileOf(key)));
      if (stored)
        keys.push({
          key,
          revision: stored.revision,
          size: Buffer.byteLength(JSON.stringify(stored.value)),
        });
    }
    return keys;
  }

  /** Removes everything every extension stored for the project. Best effort. */
  async deleteProject(projectId: string): Promise<void> {
    if (!projectIdPattern.test(projectId)) return;
    let extensions: string[];
    try {
      extensions = await readdir(this.#options.root);
    } catch {
      return;
    }
    await Promise.all(
      extensions.map((extensionId) =>
        rm(join(this.#options.root, extensionId, projectId), {
          recursive: true,
          force: true,
        }).catch(() => undefined),
      ),
    );
  }

  /** The store as the backend sees it: bound to one project, its writes carry no origin. */
  forProject(projectId: string): ExtensionStorePort {
    return {
      get: (extensionId, key) => this.get({ extensionId, projectId }, key),
      set: (extensionId, key, value, ifRevision) =>
        this.set({ extensionId, projectId }, key, value, { ifRevision }),
      delete: (extensionId, key, ifRevision) =>
        this.delete({ extensionId, projectId }, key, { ifRevision }),
      keys: (extensionId, prefix) =>
        this.keys({ extensionId, projectId }, prefix),
    };
  }

  #dir(scope: Scope): string {
    // The ids become folder names: only the id schemas' characters get that far.
    if (!extensionIdSchema.safeParse(scope.extensionId).success)
      throw new ExtensionStoreError("invalid_request", "Invalid extension id.");
    if (!projectIdPattern.test(scope.projectId))
      throw new ExtensionStoreError("invalid_request", "Invalid project id.");
    if (!this.#options.projectExists(scope.projectId))
      throw new ExtensionStoreError("not_found", "The project does not exist.");
    return join(this.#options.root, scope.extensionId, scope.projectId);
  }

  /** Whether writing `json` under `key` stays within the key count and byte limits of the project. */
  async #checkRoom(dir: string, key: string, json: string): Promise<void> {
    const keys = await storedKeys(dir);
    if (!keys.includes(key) && keys.length >= bridgeLimits.maxStoreKeys)
      throw new ExtensionStoreError(
        "too_large",
        `The store already holds ${bridgeLimits.maxStoreKeys} keys; delete some first.`,
      );
    let bytes = Buffer.byteLength(json);
    for (const other of keys) {
      if (other === key) continue;
      bytes += await stat(join(dir, fileOf(other))).then(
        (info) => info.size,
        () => 0,
      );
    }
    if (bytes > bridgeLimits.maxStoreBytesPerProject)
      throw new ExtensionStoreError(
        "too_large",
        `The store would exceed ${bridgeLimits.maxStoreBytesPerProject} bytes for this project; delete some keys first.`,
      );
  }

  #changed(
    scope: Scope,
    key: string,
    revision: number | null,
    origin: string | undefined,
  ): void {
    this.#options.onChange?.({
      ...scope,
      key,
      revision,
      ...(origin !== undefined ? { origin } : {}),
    });
  }
}

const fileOf = (key: string) => `${key}${fileSuffix}`;

function checkedKey(key: string): string {
  const parsed = extensionStoreKeySchema.safeParse(key);
  if (!parsed.success)
    throw new ExtensionStoreError(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Invalid key.",
    );
  return key;
}

/** The JSON text of `value`; refuses anything but plain JSON within the value limit. */
function serialize(value: unknown): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  if (
    json === undefined ||
    !bridgeJsonSchema.safeParse(JSON.parse(json)).success
  )
    throw new ExtensionStoreError("invalid_request", "The value is not JSON.");
  if (Buffer.byteLength(json) > bridgeLimits.maxStoreValueBytes)
    throw new ExtensionStoreError(
      "too_large",
      `The value is larger than ${bridgeLimits.maxStoreValueBytes} bytes.`,
    );
  return json;
}

function checkRevision(
  key: string,
  current: Stored | undefined,
  expected: number | undefined,
): void {
  if (expected !== undefined && expected !== (current?.revision ?? 0))
    throw new ExtensionStoreError(
      "conflict",
      `Key '${key}' is at revision ${current?.revision ?? 0}, not ${expected}.`,
    );
}

async function readStored(file: string): Promise<Stored | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as Partial<Stored>;
    return Number.isInteger(parsed.revision) && "value" in parsed
      ? (parsed as Stored)
      : undefined;
  } catch {
    // A file that is not ours to read counts as absent.
    return undefined;
  }
}

async function storedKeys(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((name) => name.endsWith(fileSuffix) && !name.startsWith("."))
      .map((name) => name.slice(0, -fileSuffix.length))
      .sort();
  } catch {
    return [];
  }
}
