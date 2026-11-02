import {
  syncDirectory,
  syncFile,
  renameWithRetrySync,
} from "../../framework/durability.js";
import type { StepContext } from "../../framework/step.js";
import { HOME_CONFIGURATION_FILES } from "./owned-paths.js";
import { convertPermissionRules } from "./process-history.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Legacy, LegacyReader } from "./legacy.reader.js";
import { preserveForRollback } from "../../framework/rollback-journal.js";
import {
  consumeCheckedDocument,
  invalidateCheckedDocument,
  isUnreadableDocument,
} from "./config-preflight.js";

export function atomicWrite(path: string, content: string): void {
  invalidateCheckedDocument(path);
  preserveForRollback(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  preserveForRollback(temporary);
  try {
    writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
    syncFile(temporary);
    renameWithRetrySync(temporary, path);
    syncDirectory(dirname(path));
  } finally {
    rmSync(temporary, { force: true });
  }
}
export const writeJson = (path: string, value: unknown) =>
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
export function readJson(path: string, fallback: Legacy = {}): Legacy {
  if (isUnreadableDocument(path)) return fallback;
  const checked = consumeCheckedDocument(path);
  if (checked) return checked;
  try {
    assert(
      lstatSync(path).isFile(),
      `Expected regular configuration file ${path}`,
    );
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return fallback;
  }
}
const digest = (text: string) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
const normalizeDigest = (value: string) =>
  value.startsWith("sha256:") ? value : `sha256:${value}`;

/** Only named legacy settings slots, never arbitrary provider/plugin fields. */
export function convertSettings(document: Legacy): boolean {
  let changed = false;
  const rename = (selection: Legacy | undefined, old: string, next: string) => {
    if (!selection || !Object.hasOwn(selection, old)) return;
    selection[next] ??= selection[old];
    delete selection[old];
    changed = true;
  };
  rename(document, "defaultPermissionLevel", "defaultPermissionRuleSetId");
  for (const key of ["defaults", "lastSelection", "lastAgentSelection"]) {
    const selection = document[key];
    rename(selection, "permissionLevel", "permissionRuleSetId");
    if (selection)
      for (const removed of ["workspaceScope", "budget"])
        if (Object.hasOwn(selection, removed)) {
          delete selection[removed];
          changed = true;
        }
  }
  return convertPermissionRules(document) || changed;
}
function renameSuggestionFilter(text: string): string {
  const match = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
  if (!match) return text;
  const lines = match[2].split(/\r?\n/);
  let when = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^(?:when|["']when["']):/.test(line)) {
      when = true;
      if (line.includes("{"))
        lines[index] = line.replace(
          /\bpermissionLevels(?=["']?\s*:)/g,
          "permissionRuleSets",
        );
    } else if (/^\S/.test(line)) when = false;
    else if (when)
      lines[index] = line.replace(
        /^(\s+["']?)permissionLevels(?=["']?\s*:)/,
        "$1permissionRuleSets",
      );
  }
  const newline = match[1].includes("\r") ? "\r\n" : "\n";
  return (
    match[1] + lines.join(newline) + match[3] + text.slice(match[0].length)
  );
}
export async function convertConfiguration(
  home: string,
  scratch: string,
  ctx: StepContext,
): Promise<{ settings: number; suggestions: number }> {
  let settings = 0,
    suggestions = 0;
  const config = join(home, "config");
  for (const directory of [config, join(config, "rule-sets")]) {
    if (!existsSync(directory)) continue;
    for (const name of directory === config
      ? HOME_CONFIGURATION_FILES
      : readdirSync(directory)) {
      if (!name.endsWith(".json") || !existsSync(join(directory, name)))
        continue;
      const path = join(directory, name);
      await ctx.unit(
        { kind: "configuration", id: path, title: `User settings: ${name}` },
        () => {
          const document = readJson(path);
          if (convertSettings(document)) {
            writeJson(path, document);
            settings++;
          }
        },
        { quarantine: { files: [path] } },
      );
    }
  }
  const directory = join(home, "agent", "suggestions"),
    checkpoint = join(scratch, "suggestion-digests.json");
  const conversions = readJson(checkpoint);
  if (existsSync(directory))
    for (const name of readdirSync(directory)) {
      if (!name.endsWith(".md")) continue;
      const path = join(directory, name);
      await ctx.unit(
        {
          kind: "configuration",
          id: path,
          title: `Prompt suggestion: ${name}`,
        },
        () => {
          assert(lstatSync(path).isFile());
          const before = readFileSync(path, "utf8"),
            after = renameSuggestionFilter(before);
          if (after !== before) {
            conversions[path] = {
              before: digest(before),
              after: digest(after),
            };
            // Retain the old approved digest before replacing its file, across crashes.
            writeJson(checkpoint, conversions);
            atomicWrite(path, after);
            suggestions++;
          }
        },
        { quarantine: { files: [path] } },
      );
    }
  return { settings, suggestions };
}

function predicate(text: string): string | null {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontmatter) return null;
  const lines = frontmatter.split(/\r?\n/),
    index = lines.findIndex((line) =>
      /^(?:enable-js|["']enable-js["']):/.test(line),
    );
  if (index < 0) return null;
  const value = lines[index].slice(lines[index].indexOf(":") + 1).trim();
  if (/^\|[+-]?$/.test(value)) {
    const body: string[] = [];
    for (
      let cursor = index + 1;
      cursor < lines.length &&
      (!lines[cursor].trim() || /^\s/.test(lines[cursor]));
      cursor++
    )
      body.push(lines[cursor]);
    const indentation = Math.min(
      ...body
        .filter((line) => line.trim())
        .map((line) => line.match(/^\s*/)?.[0].length ?? 0),
    );
    return (
      body
        .map((line) => line.slice(indentation))
        .join("\n")
        .trim() || null
    );
  }
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value).trim();
    } catch {
      return null;
    }
  }
  if (value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replaceAll("''", "'").trim();
  return value && !/^[>|]/.test(value) ? value : null;
}
/** Never reinterpret predicate hashes as file digests: validate approved JS first. */
export function convertPromptTrust(
  data: Legacy,
  home: string,
  scratch: string,
): Legacy | null {
  let path = data.path;
  if (data.sourceKind === "user" && typeof path === "string") {
    const segment = path.replaceAll("\\", "/").split("/agent/suggestions/")[1];
    if (!segment || segment.includes("/") || segment === "..") return null;
    path = join(home, "agent", "suggestions", segment);
  }
  if (typeof path !== "string") return null;
  const status = ["denied", "rejected"].includes(data.status)
    ? "rejected"
    : "trusted";
  // Project files are never opened by home migration. Existing byte digests can
  // be imported unchanged; predicate-only approvals require project reapproval.
  if (data.sourceKind !== "user") {
    const approved = data.contentDigest ?? data.digest;
    return approved
      ? { ...data, path, status, contentDigest: normalizeDigest(approved) }
      : null;
  }
  try {
    const text = readFileSync(path, "utf8"),
      current = digest(text);
    const old = data.contentDigest ?? data.digest;
    if (old) {
      const conversions = readJson(join(scratch, "suggestion-digests.json"));
      const approved = normalizeDigest(old);
      const converted =
        conversions[path]?.before === approved &&
        conversions[path]?.after === current;
      return {
        ...data,
        path,
        status,
        contentDigest: converted ? current : approved,
      };
    }
    const code = predicate(text);
    // A malformed/unsupported old YAML predicate must be reapproved, not guessed.
    if (
      status === "trusted" &&
      (!code || digest(code) !== normalizeDigest(data.predicateHash ?? ""))
    )
      return null;
    return { ...data, path, status, contentDigest: current };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function convertDocumentPreferences(
  reader: LegacyReader,
  home: string,
  ctx?: StepContext,
): Promise<{ enablement: number }> {
  const path = join(home, "config", "prompt-suggestions.json"),
    preferences = readJson(path, { version: 1, enabled: {} });
  assert(
    preferences.version === 1 &&
      preferences.enabled &&
      typeof preferences.enabled === "object",
  );
  let enablement = 0;
  const unit = async (
    namespace: string,
    row: Record<string, unknown>,
    fn: () => void,
  ) => {
    if (!ctx) return fn();
    await ctx.unit(
      {
        kind: "configuration",
        id: `legacy-record:${namespace}/${row.document_id}`,
        title: "Prompt suggestion settings",
      },
      fn,
    );
  };
  for (const { row, data } of reader.documents(
    "prompt_suggestion_enablement",
  )) {
    await unit("prompt_suggestion_enablement", row, () => {
      assert(
        typeof data.definitionKey === "string" &&
          typeof data.enabled === "boolean",
      );
      preferences.enabled[data.definitionKey] ??= data.enabled;
      enablement++;
    });
  }
  if (enablement) writeJson(path, preferences);
  return { enablement };
}
