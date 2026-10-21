import {
  existsSync,
  readdirSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  profilesDocument,
  profileConversionReceipt,
  enabledPreferences,
  profileEntry,
  parseProfileMarkdown,
  type ProfileEntry,
} from "./subagent-profile-format.js";
import { join, resolve, parse, relative, isAbsolute, sep } from "node:path";
import { readJson, writeJson } from "./configuration.js";
import type { Legacy } from "./legacy.reader.js";
import { preserveForRollback } from "../../framework/rollback-journal.js";
import { isUnreadableDocument } from "./config-preflight.js";

// Frozen copies of the built-in profile text at the conversion boundary.
const builtIns = {
  explore: {
    label: "Explore",
    description:
      "Read-only codebase and web research; returns a report with paths and evidence.",
    permission: "read_only",
    skills: "none",
    instructions: `You are a read-only researcher. Investigate the assignment and report what you find; do not modify files.

- Search and read the codebase, and use the web when the assignment needs it.
- Stay within the assignment. Prefer a few targeted searches over exhaustive reading.
- Back every claim with evidence: file paths with line numbers, command output, or URLs.
- Say plainly when something could not be found or is uncertain.

End with a short report using these headings: Summary, Relevant files, Evidence, Open questions.`,
  },
  developer: {
    label: "Developer",
    description:
      "Implements, tests and fixes code in the shared worktree within an assigned scope.",
    permission: "autonomous",
    skills: "inherit",
    instructions: `You are a developer working in a shared worktree on an assigned scope. Other agents may be editing other files at the same time.

- Stay within the assigned scope. If the work needs changes outside it, report that instead of making them.
- Never revert, overwrite or reformat changes you did not make.
- Run the tests and checks relevant to your changes, and fix what you broke.
- Do not commit unless the assignment says so.

End with a short report using these headings: Changes (files and what changed), Validation (what you ran and the results), Left to do (anything unfinished or needing a decision).`,
  },
} as const;

const subagentTools = ["subagent_prompt", "subagent_status", "subagent_stop"];
const legacySubagentTools = ["subagent_new", "subagent_list"];

function profileFile(
  name: keyof typeof builtIns,
  model: string,
  thinking: string,
  compaction: unknown,
): ProfileEntry {
  return profileEntry.parse({ ...builtIns[name], model, thinking, compaction });
}

const modelId = (selection: Legacy | undefined): string | null =>
  selection &&
  typeof selection.provider === "string" &&
  typeof selection.modelId === "string"
    ? `${selection.provider}/${selection.modelId}`
    : null;

/** Customized legacy Explore/async-subagent settings become user JSON entries. */
function customizedProfiles(
  harness: Legacy,
): Array<[keyof typeof builtIns, ProfileEntry]> {
  const profiles: Array<[keyof typeof builtIns, ProfileEntry]> = [];
  const explore = harness.exploreAgent as Legacy | undefined;
  if (explore) {
    const model = modelId(explore.model);
    const thinking = explore.thinkingLevel ?? "off";
    // Without a configured model the old default (`off`) is the built-in behavior.
    if (model || thinking !== "off")
      profiles.push([
        "explore",
        profileFile("explore", model ?? "lead", thinking, "inherit"),
      ]);
  }
  const developer = harness.asyncSubagent as Legacy | undefined;
  if (developer) {
    const model = modelId(developer.model);
    const profile = developer.compactionProfile ?? "inherit";
    // The old thinking level applied only together with a configured model.
    if (model || profile !== "inherit")
      profiles.push([
        "developer",
        profileFile(
          "developer",
          model ?? "lead",
          model ? (developer.thinkingLevel ?? "lead") : "lead",
          profile === "inherit"
            ? "inherit"
            : {
                profile,
                ...(profile === "custom"
                  ? {
                      triggerPercent: developer.customTriggerPercent,
                      keepRecentPercent: developer.customKeepRecentPercent,
                    }
                  : {}),
              },
        ),
      ]);
  }
  return profiles;
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const own = <T>(record: Record<string, T>, name: string): T | undefined =>
  Object.hasOwn(record, name) ? record[name] : undefined;

/** Reject symlinks in every existing ancestor, including dangling target links.
 * Migration paths must be regular directories/files, not redirects outside a scope.
 */
function verifyAncestors(path: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    assert(!stat.isSymbolicLink(), `Symlinked migration path: ${current}`);
    if (index < parts.length - 1)
      assert(stat.isDirectory(), `Expected directory ${current}`);
  }
}

/** Capture before user conversion and retain across retries of the draft step. */
export function captureLegacyProfileEnablement(
  home: string,
  scratch: string,
): Record<string, boolean> {
  const snapshot = join(scratch, "subagent-legacy-enablement.json");
  verifyAncestors(snapshot);
  if (existsSync(snapshot))
    return enabledPreferences.parse(readJson(snapshot)).enabled;
  const target = join(home, "config", "subagents.json");
  const harnessPath = join(home, "config", "harness.json");
  verifyAncestors(target);
  verifyAncestors(harnessPath);
  const existing = existsSync(target) ? readJson(target) : undefined;
  const preferences =
    existing && !Object.hasOwn(existing, "schemaVersion")
      ? enabledPreferences.parse(existing).enabled
      : {};
  if (existsSync(target) && !existing) profilesDocument.parse(existing);
  if (existing && Object.hasOwn(existing, "schemaVersion"))
    profilesDocument.parse(existing);
  const disabled = readJson(harnessPath).tools?.disabled;
  if (Array.isArray(disabled) && disabled.includes("explore"))
    preferences.explore = false;
  writeJson(snapshot, { enabled: preferences });
  assert.deepEqual(
    enabledPreferences.parse(readJson(snapshot)).enabled,
    preferences,
  );
  return preferences;
}

export function profileReceiptPath(scratch: string, root: string): string {
  return join(scratch, `subagent-profiles-${hash(resolve(root))}.json`);
}

type ScopeOptions = {
  legacyEnabled?: Record<string, boolean>;
  receiptPath?: string;
  inheritedProfiles?: Record<string, ProfileEntry>;
};

/** Verify atomic JSON before deleting sources. A receipt records the planned
 * document and source hashes before replacement; resume re-verifies both against
 * disk. Without that evidence, any different existing entry is a collision.
 * Markdown trust never authorizes the new JSON document.
 */
export function convertProfileScope(
  root: string,
  markdownDirectory: string,
  customizations: Array<[string, ProfileEntry]> = [],
  disabledExplore = false,
  options: ScopeOptions = {},
): number {
  const target = join(root, "config", "subagents.json");
  const sourceRelative = relative(resolve(root), resolve(markdownDirectory));
  assert(
    sourceRelative &&
      !sourceRelative.startsWith("..") &&
      !isAbsolute(sourceRelative),
    "Profile sources outside scope",
  );
  verifyAncestors(target);
  verifyAncestors(markdownDirectory);
  if (options.receiptPath) verifyAncestors(options.receiptPath);
  const hasTarget = existsSync(target);
  const existing = hasTarget ? readJson(target) : undefined;
  const oldPreferences =
    existing && !Object.hasOwn(existing, "schemaVersion")
      ? enabledPreferences.parse(existing)
      : undefined;
  const document = profilesDocument.parse(
    oldPreferences || !hasTarget
      ? { schemaVersion: 1, profiles: {} }
      : existing,
  );
  const canonicalExploreEnabled = oldPreferences
    ? undefined
    : own(document.profiles, "explore")?.enabled;
  const receipt =
    options.receiptPath && existsSync(options.receiptPath)
      ? profileConversionReceipt.parse(readJson(options.receiptPath))
      : undefined;
  const verifiedResume =
    receipt && !oldPreferences && isDeepStrictEqual(receipt.document, document);
  const sources: Record<string, string> = {};
  if (existsSync(markdownDirectory)) {
    assert(
      lstatSync(markdownDirectory).isDirectory(),
      "Expected regular profile directory",
    );
    for (const file of readdirSync(markdownDirectory).sort()) {
      if (file.startsWith(".") || !/\.md$/i.test(file)) continue;
      const path = join(markdownDirectory, file);
      verifyAncestors(path);
      assert(lstatSync(path).isFile(), `Expected regular profile file ${path}`);
      const name = file.replace(/\.md$/i, "");
      const raw = readFileSync(path, "utf8");
      const entry = parseProfileMarkdown(name, raw);
      const enabled = own(options.legacyEnabled ?? {}, name);
      if (enabled !== undefined) entry.enabled = enabled;
      const current = own(document.profiles, name);
      const inherited = own(options.inheritedProfiles ?? {}, name);
      if (!current && inherited) {
        const missingTools = Object.keys(inherited.tools ?? {}).filter(
          (key) => !Object.hasOwn(entry.tools ?? {}, key),
        );
        const lowerSkills = inherited.skills;
        const upperSkills = entry.skills;
        const missingSkills =
          lowerSkills &&
          typeof lowerSkills === "object" &&
          upperSkills &&
          typeof upperSkills === "object"
            ? Object.keys(lowerSkills).filter(
                (key) => !Object.hasOwn(upperSkills, key),
              )
            : [];
        assert(
          !missingTools.length && !missingSkills.length,
          `Manual review required for legacy project subagent ${name} at ${path}: whole-definition capability shadowing cannot become sparse JSON without changing parent inheritance (tools: ${missingTools.join(", ") || "none"}; skills: ${missingSkills.join(", ") || "none"}). Resolve the selections explicitly in ${target} and archive the reviewed conflicting Markdown before retrying; legacy files have not been removed.`,
        );
      }
      const resumedSource =
        verifiedResume && own(receipt.sources, path) === hash(raw);
      assert(
        !current || isDeepStrictEqual(current, entry) || resumedSource,
        `Subagent profile collision: ${name} at ${target}`,
      );
      if (!current) document.profiles[name] = entry;
      sources[path] = hash(raw);
    }
  }
  for (const [name, entry] of customizations)
    if (!Object.hasOwn(document.profiles, name))
      document.profiles[name] = entry;
  for (const [name, enabled] of Object.entries(oldPreferences?.enabled ?? {}))
    document.profiles[name] = { ...own(document.profiles, name), enabled };
  if (
    disabledExplore &&
    (oldPreferences || canonicalExploreEnabled === undefined)
  )
    document.profiles.explore = {
      ...own(document.profiles, "explore"),
      enabled: false,
    };
  if (
    !Object.keys(sources).length &&
    !customizations.length &&
    !oldPreferences &&
    !disabledExplore
  )
    return 0;
  profilesDocument.parse(document);
  if (options.receiptPath) {
    verifyAncestors(options.receiptPath);
    writeJson(options.receiptPath, { document, sources });
  }
  verifyAncestors(target);
  writeJson(target, document);
  assert.deepEqual(
    profilesDocument.parse(readJson(target)),
    document,
    `Subagent JSON verification failed: ${target}`,
  );
  for (const [path, digest] of Object.entries(sources)) {
    verifyAncestors(path);
    assert.equal(
      hash(readFileSync(path, "utf8")),
      digest,
      `Profile changed during conversion: ${path}`,
    );
    preserveForRollback(path);
    rmSync(path);
  }
  return (
    Object.keys(sources).length +
    customizations.length +
    (oldPreferences ? 1 : 0)
  );
}

/** Harness conversion is committed only after the consolidated user JSON is verified. */
export function convertSubagentSettings(
  home: string,
  scratch?: string,
): number {
  const path = join(home, "config", "harness.json");
  verifyAncestors(path);
  const harness = readJson(path);
  const disabled: unknown = harness.tools?.disabled;
  const names = Array.isArray(disabled) ? disabled.map(String) : [];
  const hasExplore = names.includes("explore");
  let changed = convertProfileScope(
    home,
    join(home, "agent", "subagents"),
    customizedProfiles(harness),
    hasExplore,
    { receiptPath: scratch ? profileReceiptPath(scratch, home) : undefined },
  );
  const groupDisabled = names.some(
    (name) =>
      legacySubagentTools.includes(name) || subagentTools.includes(name),
  );
  if (hasExplore || names.some((name) => legacySubagentTools.includes(name))) {
    harness.tools.disabled = [
      ...new Set([
        ...names.filter(
          (name) =>
            name !== "explore" &&
            !legacySubagentTools.includes(name) &&
            !subagentTools.includes(name),
        ),
        ...(groupDisabled ? subagentTools : []),
      ]),
    ];
    changed++;
  }
  if ("exploreAgent" in harness || "asyncSubagent" in harness) {
    delete harness.exploreAgent;
    delete harness.asyncSubagent;
    changed++;
  }
  // An unreadable harness is left for startup recovery, never overwritten.
  if (changed && existsSync(path) && !isUnreadableDocument(path))
    writeJson(path, harness);
  return changed;
}

/**
 * Copies the Explore reports written for one legacy child agent into its
 * conversation directory. The legacy tree is removed in cleanup, after verification.
 */
export function copyExploreReports(
  dataDir: string,
  legacyConversationId: string,
  agentId: string,
  childConversationId: string,
): number {
  let copied = 0;
  for (const owner of new Set([
    legacyConversationId,
    legacyConversationId.replace(/^conv_/, ""),
  ])) {
    const root = join(dataDir, "reports", "conversations", owner);
    if (!existsSync(root) || !lstatSync(root).isDirectory()) continue;
    for (const batch of readdirSync(root, { withFileTypes: true })) {
      if (!batch.isDirectory()) continue;
      for (const file of readdirSync(join(root, batch.name), {
        withFileTypes: true,
      })) {
        if (!file.isFile() || !file.name.endsWith(`-${agentId}.md`)) continue;
        const directory = join(
          dataDir,
          "conversations",
          childConversationId,
          "reports",
        );
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const target = join(directory, file.name);
        const temporary = `${target}.migrating`;
        try {
          copyFileSync(join(root, batch.name, file.name), temporary);
          renameSync(temporary, target);
        } finally {
          rmSync(temporary, { force: true });
        }
        copied++;
      }
    }
  }
  return copied;
}

/** Count of legacy report files, for the unmatched-report diagnostic. */
export function countLegacyReports(dataDir: string): number {
  const walk = (directory: string): number =>
    existsSync(directory)
      ? readdirSync(directory, { withFileTypes: true }).reduce(
          (sum, entry) =>
            sum +
            (entry.isDirectory()
              ? walk(join(directory, entry.name))
              : entry.isFile()
                ? 1
                : 0),
          0,
        )
      : 0;
  return walk(join(dataDir, "reports"));
}
