import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import {
  conversationJournalCommitSchema,
  projectPermissionsSchema,
  settingsSchema,
} from "@nervekit/contracts";
import { journalChecksum } from "../../../domains/conversations/conversation-journal.repository.js";
import { atomicWriteFile } from "../../storage/file-mutations.js";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../storage/json.js";
import { migrateLegacyPermissionValue } from "../../storage/legacy-permission-rules.js";
import { normalizeSettings } from "../../storage/settings-normalization.js";
import { migrationChecksum } from "../checksum.js";
import type { StorageMigration } from "../migration.js";

const markerPath = "migrations/.permission-rules-v2";

export const migration0016: StorageMigration = {
  id: "0016-permission-rules",
  description: "Store permission exceptions as tool, effect, and rule",
  checksum: migrationChecksum(
    "0016-permission-rules|v1|Store permission exceptions as tool, effect, and rule",
  ),
  async detect(context) {
    return (await pathExists(join(context.paths.home, markerPath)))
      ? "current"
      : "pending";
  },
  async backup(context) {
    return {
      paths: [...(await permissionRecordPaths(context.paths.home)), markerPath],
    };
  },
  async up(context) {
    const paths = await permissionRecordPaths(context.paths.home);
    for (const relativePath of paths) {
      const file = join(context.paths.home, relativePath);
      if (relativePath === "config.json") {
        const settings = normalizeSettings(
          await readJsonFile<unknown>(file),
        ).settings;
        await atomicWriteJson(file, settings, 0o600);
      } else if (relativePath.endsWith("/permissions.json")) {
        const migrated = migrateLegacyPermissionValue(
          await readJsonFile<unknown>(file),
        );
        await atomicWriteJson(
          file,
          projectPermissionsSchema.parse(migrated),
          0o600,
        );
      } else if (
        relativePath.startsWith("conversations/") &&
        relativePath.endsWith("/journal.jsonl")
      ) {
        await migrateConversationJournal(file);
      } else {
        await migrateJsonLines(file);
      }
    }
    await atomicWriteJson(
      join(context.paths.home, markerPath),
      { migratedAt: context.now().toISOString(), rewrittenFiles: paths.length },
      0o600,
    );
  },
  async verify(context) {
    if (!(await pathExists(join(context.paths.home, markerPath)))) {
      throw new Error("Permission rules migration marker is missing.");
    }
    const config = join(context.paths.home, "config.json");
    if (await pathExists(config))
      settingsSchema.parse(await readJsonFile(config));
    for (const relativePath of await projectPermissionPaths(
      context.paths.home,
    )) {
      projectPermissionsSchema.parse(
        await readJsonFile(join(context.paths.home, relativePath)),
      );
    }
  },
};

async function permissionRecordPaths(home: string): Promise<string[]> {
  const paths: string[] = [];
  if (await pathExists(join(home, "config.json"))) paths.push("config.json");
  paths.push(...(await projectPermissionPaths(home)));
  for (const directory of ["conversations", "logs"]) {
    paths.push(...(await jsonLinePaths(home, directory)));
  }
  return [...new Set(paths)].sort();
}

async function projectPermissionPaths(home: string): Promise<string[]> {
  const projects = await readdir(join(home, "projects"), {
    withFileTypes: true,
  }).catch(() => []);
  const paths: string[] = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const path = `projects/${project.name}/permissions.json`;
    if (await pathExists(join(home, path))) paths.push(path);
  }
  return paths;
}

async function jsonLinePaths(
  home: string,
  directory: string,
): Promise<string[]> {
  const root = join(home, directory);
  const files = await descendants(root);
  return files
    .filter((file) => extname(file) === ".jsonl")
    .map((file) => relative(home, file).split(sep).join("/"));
}

async function descendants(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await descendants(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function migrateConversationJournal(file: string): Promise<void> {
  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/);
  const decoded = lines.map((line, index) => {
    if (!line.trim()) return undefined;
    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(
        `Conversation journal is malformed at line ${index + 1}.`,
        { cause: error },
      );
    }
  });
  const migrated = decoded.map((value) =>
    value === undefined ? undefined : migrateLegacyPermissionValue(value),
  );
  const changed = decoded.some(
    (value, index) => JSON.stringify(value) !== JSON.stringify(migrated[index]),
  );
  if (!changed) return;

  let originalRevision = 0;
  let originalChecksum: string | undefined;
  let migratedChecksum: string | undefined;
  const rewritten = migrated.map((value, index) => {
    if (value === undefined) return lines[index] ?? "";
    const original = decoded[index];
    if (!isRecord(original) || typeof original.checksum !== "string") {
      throw new Error(
        `Conversation journal commit is malformed at line ${index + 1}.`,
      );
    }
    const { checksum, ...originalBase } = original;
    if (
      typeof original.revision !== "number" ||
      original.previousRevision !== originalRevision ||
      original.revision !== originalRevision + 1 ||
      original.previousChecksum !== originalChecksum ||
      journalChecksum(originalBase) !== checksum
    ) {
      throw new Error(
        `Conversation journal chain is invalid at line ${index + 1}.`,
      );
    }
    originalRevision = original.revision;
    originalChecksum = checksum;

    if (!isRecord(value)) {
      throw new Error(
        `Conversation journal commit is malformed at line ${index + 1}.`,
      );
    }
    const candidate = {
      ...value,
      previousChecksum: migratedChecksum,
      checksum: `sha256:${"0".repeat(64)}`,
    };
    const normalized = conversationJournalCommitSchema.parse(candidate);
    const { checksum: normalizedChecksum, ...base } = normalized;
    if (normalizedChecksum !== candidate.checksum) {
      throw new Error(
        `Conversation journal checksum normalization failed at line ${index + 1}.`,
      );
    }
    const commit = conversationJournalCommitSchema.parse({
      ...base,
      checksum: journalChecksum(base),
    });
    migratedChecksum = commit.checksum;
    return JSON.stringify(commit);
  });
  await atomicWriteFile(file, rewritten.join("\n"), { mode: 0o600 });
}

async function migrateJsonLines(file: string): Promise<void> {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  let changed = false;
  const migrated = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      const value = JSON.parse(line) as unknown;
      const next = migrateLegacyPermissionValue(value);
      const output = JSON.stringify(next);
      changed ||= output !== line;
      return output;
    } catch {
      return line;
    }
  });
  if (changed)
    await atomicWriteFile(file, migrated.join("\n"), { mode: 0o600 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
