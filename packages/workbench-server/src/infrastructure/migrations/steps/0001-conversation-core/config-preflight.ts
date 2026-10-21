import { checkedText } from "../../framework/toolkit.js";
import assert from "node:assert/strict";
import {
  HOME_CONFIGURATION_FILES,
  PROJECT_CONFIGURATION_FILES,
} from "./owned-paths.js";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { StepContext, DiscardableItem } from "../../framework/step.js";
import { capabilityOverridesDocumentSchema } from "./capabilities.js";
import type { Legacy, LegacyReader } from "./legacy.reader.js";
import { convertPermissionRules } from "./process-history.js";
import type { RollbackJournal } from "../../framework/rollback-journal.js";
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
  "capabilities.json": (document) => {
    capabilityOverridesDocumentSchema.parse(document);
  },
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
  root: string;
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
      root: home,
      title: `User settings: ${relative(home, path)}`,
      validate: validate ?? validators[basename(path)],
    });
  for (const name of HOME_CONFIGURATION_FILES) user(join(home, "config", name));
  for (const path of jsonFiles(join(home, "config", "rule-sets"))) user(path);

  for (const { data } of reader.documents("project")) {
    const directory = data.dir ?? data.directory;
    if (typeof directory !== "string") continue;
    const nerve = join(resolve(directory), ".nerve");
    const project = (path: string, validate?: Validate) =>
      result.push({
        path,
        root: resolve(directory),
        title: `Project ${data.name ?? basename(directory)}: ${relative(directory, path)}`,
        validate,
      });
    for (const name of PROJECT_CONFIGURATION_FILES)
      project(join(nerve, "config", name), validators[name]);
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
        root: home,
        title: `Conversation ${name}: capabilities.json`,
        validate: (document) =>
          capabilityOverridesDocumentSchema.parse(document),
      },
      {
        path: join(directory, "permissions.json"),
        root: home,
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

/**
 * Validate every JSON configuration file the step will read before any is
 * converted. Set-aside moves are deferred until run and journaled for rollback.
 */
export async function checkConfiguration(input: {
  home: string;
  context: StepContext;
  dataDir: string;
  reader: LegacyReader;
  discarded: ReadonlySet<string>;
}): Promise<{
  failures: DiscardableItem[];
  apply(journal: RollbackJournal, log: (message: string) => void): void;
}> {
  unreadable = new Set();
  checkedDocuments.clear();
  checkedTexts.clear();
  const failures: DiscardableItem[] = [];
  const files = candidates(
    input.home,
    input.dataDir,
    input.reader,
    input.discarded,
  );
  for (const candidate of files)
    input.context.ownPaths([candidate.path], candidate.root);
  for (const candidate of files) {
    const path = resolve(candidate.path);
    if (!lstatSync(path, { throwIfNoEntry: false })) continue;
    const runtime =
      resolve(path, "..") === resolve(input.home, "config") &&
      RUNTIME_DOCUMENTS.has(basename(path));
    const item = {
      kind: "configuration" as const,
      id: path,
      title: candidate.title,
    };
    await input.context.unit(
      item,
      () => {
        try {
          assert(lstatSync(path).isFile(), "Not a regular file");
          const value = input.context.readJson(path, {
            parse(value: unknown) {
              const document = value as Legacy;
              object(document);
              candidate.validate?.(structuredClone(document));
              return document;
            },
          });
          if (value) {
            checkedDocuments.set(path, value);
            const text = checkedText(input.context, path);
            if (text !== undefined) checkedTexts.set(path, text);
          }
        } catch (error) {
          if (runtime) {
            unreadable.add(path);
            return;
          }
          failures.push({ ...item, reason: reasonOf(error) });
          throw error;
        }
      },
      runtime ? {} : { quarantine: { files: [path], root: candidate.root } },
    );
  }
  return { failures, apply() {} };
}

export async function preflightConfiguration(
  input: Parameters<typeof checkConfiguration>[0] & {
    journal: RollbackJournal;
    log(message: string): void;
  },
): Promise<DiscardableItem[]> {
  const checked = await checkConfiguration(input);
  return checked.failures;
}

const checkedDocuments = new Map<string, Legacy>();
const checkedTexts = new Map<string, string>();
export function consumeCheckedText(path: string): string | undefined {
  const key = resolve(path);
  const text = checkedTexts.get(key);
  checkedTexts.delete(key);
  return text;
}
/** A checked input is consumed once; subsequent reads observe conversion writes. */
export function consumeCheckedDocument(path: string): Legacy | undefined {
  const key = resolve(path);
  const value = checkedDocuments.get(key);
  checkedDocuments.delete(key);
  return value;
}

/** Forget the preflight's unreadable documents once the attempt ends. */
export function resetPreflight(): void {
  unreadable = new Set();
  checkedDocuments.clear();
  checkedTexts.clear();
}

export function invalidateCheckedDocument(path: string): void {
  checkedDocuments.delete(resolve(path));
  checkedTexts.delete(resolve(path));
}
