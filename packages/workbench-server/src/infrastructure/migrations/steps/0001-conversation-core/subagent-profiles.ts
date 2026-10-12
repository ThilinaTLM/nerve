import {
  existsSync,
  readdirSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWrite, readJson, writeJson } from "./configuration.js";
import type { Legacy } from "./legacy.reader.js";

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
): string {
  const base = builtIns[name];
  const frontmatter = [
    ["label", base.label],
    ["description", base.description],
    ["model", model],
    ["thinking", thinking],
    ["permission", base.permission],
    ["compaction", compaction],
    ["skills", base.skills],
  ]
    // JSON scalars and flow maps are valid YAML.
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return `---\n${frontmatter}\n---\n\n${base.instructions}\n`;
}

const modelId = (selection: Legacy | undefined): string | null =>
  selection &&
  typeof selection.provider === "string" &&
  typeof selection.modelId === "string"
    ? `${selection.provider}/${selection.modelId}`
    : null;

/** Customized legacy Explore/async-subagent settings become user profile files. */
function customizedProfiles(
  harness: Legacy,
): Array<[keyof typeof builtIns, string]> {
  const profiles: Array<[keyof typeof builtIns, string]> = [];
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

/**
 * Moves the Explore/async-subagent settings and the legacy tool names out of
 * `config/harness.json`. Profile files are written first so an interrupted run
 * converts again from the unchanged harness file.
 */
export function convertSubagentSettings(home: string): number {
  const path = join(home, "config", "harness.json");
  if (!existsSync(path)) return 0;
  const harness = readJson(path);
  let changed = 0;
  const profiles = customizedProfiles(harness);
  for (const [name, content] of profiles) {
    const target = join(home, "agent", "subagents", `${name}.md`);
    if (!existsSync(target)) atomicWrite(target, content);
    changed++;
  }
  const disabled: unknown = harness.tools?.disabled;
  if (Array.isArray(disabled)) {
    const names = disabled.map(String);
    const hasExplore = names.includes("explore");
    const groupDisabled = names.some(
      (name) =>
        legacySubagentTools.includes(name) || subagentTools.includes(name),
    );
    if (hasExplore) {
      const preferences = readJson(join(home, "config", "subagents.json"), {
        enabled: {},
      });
      writeJson(join(home, "config", "subagents.json"), {
        ...preferences,
        enabled: { ...preferences.enabled, explore: false },
      });
    }
    if (
      hasExplore ||
      names.some((name) => legacySubagentTools.includes(name))
    ) {
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
  }
  if ("exploreAgent" in harness || "asyncSubagent" in harness) {
    delete harness.exploreAgent;
    delete harness.asyncSubagent;
    changed++;
  }
  if (changed) writeJson(path, harness);
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
