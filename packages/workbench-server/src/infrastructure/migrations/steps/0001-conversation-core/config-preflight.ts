import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { DiscardableItem } from "../../framework/step.js";
import { capabilityOverridesDocumentSchema } from "./capabilities.js";
import type { Legacy, LegacyReader } from "./legacy.reader.js";
import { convertPermissionRules } from "./process-history.js";
import type { RollbackJournal } from "./rollback-journal.js";
import { permissionOverlayDocumentForOriginSchema } from "./shapes.js";
import {
  enabledPreferences,
  profilesDocument,
} from "./subagent-profile-format.js";

/**
 * The six home documents the runtime owns. Their defaults are runtime
 * knowledge, so this step never sets them aside: it reads an unreadable one as
 * empty, leaves it untouched, and startup offers to reset it.
 */
const RUNTIME_DOCUMENTS = new Set(
  ["daemon", "harness", "ui", "permissions", "providers", "integrations"].map(
    (name) => `${name}.json`,
  ),
);

let unreadable = new Set<string>();

/** True for a runtime-owned home document that failed the preflight. */
export function isUnreadableDocument(path: string): boolean {
  return unreadable.has(resolve(path));
}

type Validate = (document: Legacy) => void;

const object: Validate = (document) =>
  assert(
    document && typeof document === "object" && !Array.isArray(document),
    "Expected a JSON object",
  );
const definitions: Validate = (document) =>
  assert(
    document.version === 1 && Array.isArray(document.definitions),
    "Expected version 1 with a definitions list",
  );
const validators: Record<string, Validate> = {
  "prompt-suggestions.json": (document) =>
    assert(
      document.version === 1 &&
        document.enabled &&
        typeof document.enabled === "object",
      "Expected version 1 with an enabled map",
    ),
  "subagents.json": (document) => {
    if (Object.hasOwn(document, "schemaVersion"))
      profilesDocument.parse(document);
    else enabledPreferences.parse(document);
  },
};

interface Candidate {
  path: string;
  title: string;
  validate?: Validate;
}

/** One line: the JSON syntax error, the first schema issue, or the assertion. */
function reasonOf(error: unknown): string {
  const issue = (error as { issues?: { path: unknown[]; message: string }[] })
    ?.issues?.[0];
  if (issue)
    return `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`;
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0].slice(0, 300);
}

function check(candidate: Candidate): string | undefined {
  try {
    if (!lstatSync(candidate.path).isFile())
      return "Not a regular file (for example a symbolic link or directory)";
    const document: Legacy = JSON.parse(readFileSync(candidate.path, "utf8"));
    object(document);
    candidate.validate?.(document);
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return reasonOf(error);
  }
}

function jsonFiles(directory: string): string[] {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(directory, name));
}

function candidates(
  home: string,
  dataDir: string,
  reader: LegacyReader,
  discarded: ReadonlySet<string>,
): Candidate[] {
  const result: Candidate[] = [];
  const user = (path: string, validate?: Validate) =>
    result.push({
      path,
      title: `User settings: ${relative(home, path)}`,
      validate: validate ?? validators[basename(path)],
    });
  for (const path of jsonFiles(join(home, "config"))) user(path);
  for (const path of jsonFiles(join(home, "config", "rule-sets"))) user(path);

  for (const { data } of reader.documents("project")) {
    const directory = data.dir ?? data.directory;
    if (typeof directory !== "string") continue;
    const nerve = join(resolve(directory), ".nerve");
    const project = (path: string, validate?: Validate) =>
      result.push({
        path,
        title: `Project ${data.name ?? basename(directory)}: ${relative(directory, path)}`,
        validate,
      });
    for (const path of jsonFiles(join(nerve, "config")))
      project(path, validators[basename(path)]);
    project(join(nerve, "tasks", "definitions.json"), definitions);
    project(join(nerve, "launches", "definitions.json"), definitions);
  }

  for (const source of reader.conversations()) {
    if (!source.data || discarded.has(source.id)) continue;
    if (!/^conv_[A-Za-z0-9_-]+$/.test(source.id)) continue;
    const directory = join(dataDir, "conversations", source.id.slice(5));
    const name =
      typeof source.data.title === "string" && source.data.title.trim()
        ? `“${source.data.title.trim()}”`
        : source.id;
    result.push(
      {
        path: join(directory, "capabilities.json"),
        title: `Conversation ${name}: capabilities.json`,
        validate: (document) =>
          capabilityOverridesDocumentSchema.parse(document),
      },
      {
        path: join(directory, "permissions.json"),
        title: `Conversation ${name}: permissions.json`,
        validate: (document) => {
          convertPermissionRules(document);
          permissionOverlayDocumentForOriginSchema("conversation").parse(
            document,
          );
        },
      },
    );
  }
  return result;
}

function asideName(path: string): string {
  for (let index = 1; ; index++) {
    const candidate = `${path}.corrupt${index === 1 ? "" : `-${index}`}`;
    if (!lstatSync(candidate, { throwIfNoEntry: false })) return candidate;
  }
}

/**
 * Validate every JSON configuration file the step will read before any is
 * converted. Discarded files are set aside as `<file>.corrupt` (journaled, so
 * rollback returns them); the rest are returned for the user to decide on.
 */
export function preflightConfiguration(input: {
  home: string;
  dataDir: string;
  reader: LegacyReader;
  discarded: ReadonlySet<string>;
  journal: RollbackJournal;
  log(message: string): void;
}): DiscardableItem[] {
  unreadable = new Set();
  const failures: DiscardableItem[] = [];
  for (const candidate of candidates(
    input.home,
    input.dataDir,
    input.reader,
    input.discarded,
  )) {
    const reason = check(candidate);
    if (!reason) continue;
    const path = resolve(candidate.path);
    const runtime =
      resolve(candidate.path, "..") === resolve(input.home, "config") &&
      RUNTIME_DOCUMENTS.has(basename(path));
    if (runtime) {
      unreadable.add(path);
      input.log(`Unreadable ${path} left for startup recovery: ${reason}`);
    } else if (input.discarded.has(path)) {
      const aside = asideName(path);
      input.journal.preserveFile(path);
      input.journal.preserveFile(aside);
      renameSync(path, aside);
      input.log(`Set aside at user request: ${path} -> ${aside}`);
    } else
      failures.push({
        kind: "configuration",
        id: path,
        title: candidate.title,
        reason,
      });
  }
  return failures;
}

/** Forget the preflight's unreadable documents once the attempt ends. */
export function resetPreflight(): void {
  unreadable = new Set();
}
