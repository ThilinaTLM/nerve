import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { migrate, openCoreDatabase } from "@nervekit/conversation-core";
import { loadSkills } from "@nervekit/harness/resources";
import { NodeExecutionEnv } from "@nervekit/harness/node";
import {
  digest as skillFolderDigest,
  files as skillFolderFiles,
} from "../../../../core-host/resources/project-skill-trust.js";
import { defineStep, type StepContext } from "../../framework/step.js";

/**
 * Nothing that changes what agents do is used until the user has trusted its exact content, at
 * user level too (docs/architecture/trust.md). This step makes the upgrade invisible:
 *
 * - The trust kinds named for the project become neutral (`project_permissions` → `permissions`,
 *   `project_capabilities` → `capabilities`, `project_skill` → `skill`).
 * - A prompt suggestion's trust now covers the whole file. User rows are recomputed from the file
 *   (a decline stays); a trusted project row is dropped, because project files are never read
 *   here, so that suggestion asks again.
 * - Every user profile, skill, rule set, permission overlay, `agent.json` and suggestion file that
 *   exists gets a `trusted` row for its current content, unless the user already decided about it.
 *   User extensions and MCP entries already have rows.
 *
 * Idempotent: renames match nothing a second time and existing rows win.
 */

const sha256 = (bytes: Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const RENAMES = [
  ["project_permissions", "permissions"],
  ["project_capabilities", "capabilities"],
  ["project_skill", "skill"],
] as const;

function filesIn(directory: string, suffix: string): string[] {
  return existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => name.endsWith(suffix) && !name.startsWith("."))
        .sort()
        .map((name) => join(directory, name))
    : [];
}

/** The folder of every user skill, found the way the resource loader finds them. */
async function userSkillFolders(context: StepContext): Promise<string[]> {
  const { paths } = context;
  const roots = [
    join(paths.agentPath, "skills"),
    join(homedir(), ".agents", "skills"),
  ].filter((root) => existsSync(root));
  if (roots.length === 0) return [];
  const loaded = await loadSkills(
    new NodeExecutionEnv({ cwd: paths.agentPath }),
    roots,
  );
  return [...new Set(loaded.skills.map((skill) => dirname(skill.filePath)))];
}

async function trustCurrentContent(context: StepContext): Promise<void> {
  const { paths } = context;
  const items: {
    kind: string;
    key: string;
    name: string | null;
    digest: () => Promise<string> | string;
  }[] = [];
  const byBytes = (kind: string, key: string) => ({
    kind,
    key,
    name: null,
    digest: () => sha256(readFileSync(key)),
  });
  for (const file of filesIn(paths.agentProfilesPath, ".json"))
    items.push(byBytes("agent_profile", file));
  for (const file of filesIn(join(paths.configPath, "rule-sets"), ".json"))
    items.push(byBytes("permission_rule_set", file));
  if (existsSync(paths.permissionsConfigPath))
    items.push(byBytes("permissions", paths.permissionsConfigPath));
  const agent = join(paths.configPath, "agent.json");
  if (existsSync(agent)) items.push(byBytes("capabilities", agent));
  for (const file of filesIn(paths.suggestionsPath, ".md"))
    items.push(byBytes("prompt_suggestion", file));
  for (const folder of await userSkillFolders(context))
    items.push({
      kind: "skill",
      key: folder,
      name: null,
      digest: async () =>
        skillFolderDigest(folder, await skillFolderFiles(folder)),
    });
  mkdirSync(dirname(paths.sqlitePath), { recursive: true });
  const db = openCoreDatabase(paths.sqlitePath);
  try {
    migrate(db);
    const now = new Date().toISOString();
    const computed: { item: (typeof items)[number]; digest: string }[] = [];
    for (const item of items)
      try {
        computed.push({ item, digest: await item.digest() });
      } catch {
        // An unreadable item asks for review at run time.
      }
    const exists = db.sqlite.prepare(
      "SELECT 1 FROM trusted_resource WHERE kind = ? AND project_id IS NULL AND resource_key = ?",
    );
    const insert = db.sqlite.prepare(
      "INSERT INTO trusted_resource (id, kind, project_id, resource_key, name, content_digest, status, grants, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, 'trusted', NULL, ?, ?)",
    );
    const rename = db.sqlite.prepare(
      "UPDATE trusted_resource SET kind = ? WHERE kind = ?",
    );
    const suggestionRows = db.sqlite
      .prepare(
        "SELECT id, resource_key FROM trusted_resource WHERE kind = 'prompt_suggestion' AND project_id IS NULL",
      )
      .all() as { id: string; resource_key: string }[];
    db.transaction(() => {
      for (const [from, to] of RENAMES) rename.run(to, from);
      // A suggestion's decision named its predicate; it now names the whole file.
      db.sqlite
        .prepare(
          "DELETE FROM trusted_resource WHERE kind = 'prompt_suggestion' AND project_id IS NOT NULL AND status = 'trusted'",
        )
        .run();
      const update = db.sqlite.prepare(
        "UPDATE trusted_resource SET content_digest = ?, updated_at = ? WHERE id = ?",
      );
      for (const row of suggestionRows)
        if (existsSync(row.resource_key))
          update.run(sha256(readFileSync(row.resource_key)), now, row.id);
      for (const { item, digest } of computed)
        if (!exists.get(item.kind, item.key))
          insert.run(
            `trust_${randomUUID().replaceAll("-", "")}`,
            item.kind,
            item.key,
            item.name,
            digest,
            now,
            now,
          );
    });
  } finally {
    db.close();
  }
}

export default defineStep({
  id: "0007-user-configuration-trust",
  description:
    "Rename project trust kinds and trust the user's existing profiles, skills, rule sets, permissions, agent settings and suggestions",
  async run(context) {
    await trustCurrentContent(context);
  },
});
