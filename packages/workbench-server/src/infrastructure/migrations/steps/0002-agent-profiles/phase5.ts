import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StepContext } from "../../framework/step.js";
import { finishPhase } from "../../framework/toolkit.js";
import { digest, json, safePath, writeJson } from "./files.js";
import { convertProfilesDocument } from "./profile-format.js";
import {
  applyLegacyLive,
  canonicalCapabilities,
  convertCapabilities,
  convertHarness,
  convertIntegrations,
  convertProfile,
  defaults,
  frozenProfileFileSchema,
  frozenAppliedSchema,
  frozenCapabilitiesSchema,
  legacyProfile,
  merge,
  projectToolOverrides,
  record,
  type Data,
} from "./phase5-format.js";

const optional = (path: string): Data | undefined => {
  safePath(path);
  return existsSync(path) ? record(json(path)) : undefined;
};
const text = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

/** A receipt binds every source byte and target before the first write. It also
 * lets retry distinguish our own outputs from unrelated collision/edit targets. */
function batch(
  ctx: StepContext,
  id: string,
  sources: readonly string[],
  targets: Record<string, unknown>,
  remove: readonly string[] = [],
) {
  const receiptPath = join(ctx.scratchDir, `phase5-${digest(id)}.json`);
  const existing = optional(receiptPath);
  const receipt = existing ?? {
    sources: Object.fromEntries(
      sources
        .filter(existsSync)
        .map((path) => [path, digest(readFileSync(path, "utf8"))]),
    ),
    targets,
  };
  if (existing)
    assert.deepEqual(
      existing.targets,
      targets,
      `Changed phase-5 conversion: ${id}`,
    );
  for (const path of sources) {
    ctx.ownPaths(
      [path],
      path.startsWith(ctx.paths.home + "/") ? ctx.paths.home : dirname(path),
    );
    safePath(path);
    if (!existsSync(path)) {
      assert(
        existing && remove.includes(path),
        `Missing migration source: ${path}`,
      );
      continue;
    }
    const actual = digest(readFileSync(path, "utf8"));
    assert(
      actual === receipt.sources[path] ||
        (Object.hasOwn(targets, path) &&
          readFileSync(path, "utf8") === text(targets[path])),
      `Source changed during phase-5 conversion: ${path}`,
    );
  }
  for (const [path, output] of Object.entries(targets)) {
    safePath(path);
    if (existsSync(path) && !Object.hasOwn(receipt.sources, path))
      assert.equal(
        readFileSync(path, "utf8"),
        text(output),
        `Phase-5 target collision: ${path}`,
      );
    ctx.ownPaths(
      [path],
      path.startsWith(ctx.paths.home + "/") ? ctx.paths.home : dirname(path),
    );
  }
  if (!existing) writeJson(ctx, receiptPath, receipt);
  for (const [path, output] of Object.entries(targets)) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== text(output))
      writeJson(ctx, path, output);
    assert.equal(readFileSync(path, "utf8"), text(output));
  }
  for (const path of remove)
    if (existsSync(path)) {
      assert.equal(
        digest(readFileSync(path, "utf8")),
        receipt.sources[path],
        `Source changed before deletion: ${path}`,
      );
      ctx.fs.remove(path);
    }
}
function sourceCatalogs(
  ctx: StepContext,
  roots: readonly string[],
  conversations: readonly string[],
): Data {
  const receipt = join(ctx.scratchDir, "phase5-source-catalogs.json");
  if (existsSync(receipt)) return record(json(receipt));
  const paths = [
    ...roots.map((root) => join(root, "config/agent-profiles.json")),
    ...conversations.flatMap((id) => [
      join(
        ctx.paths.home,
        "data/conversations",
        id,
        "config/agent-profiles.json",
      ),
      join(ctx.paths.home, "data/conversations", id, "config/subagents.json"),
    ]),
  ];
  const catalogs: Data = {};
  for (const path of paths)
    if (existsSync(path))
      catalogs[path] = {
        hash: digest(readFileSync(path, "utf8")),
        document: convertProfilesDocument(json(path)),
      };
  writeJson(ctx, receipt, catalogs);
  return catalogs;
}
function catalog(catalogs: Data, path: string): Data {
  return catalogs[path]?.document.profiles ?? {};
}
function skillKinds(home: string, project: string): Record<string, string> {
  const names: Record<string, string> = {
    planning: "nerve",
    "team-lead": "nerve",
    "skill-creator": "nerve",
  };
  for (const directory of [
    join(home, "agent/skills"),
    join(project, ".nerve/skills"),
    join(project, ".agents/skills"),
  ]) {
    safePath(directory);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name, "SKILL.md");
      safePath(path);
      if (existsSync(path)) {
        const name =
          /^name:\s*["']?([^\n"']+)/m
            .exec(readFileSync(path, "utf8"))?.[1]
            ?.trim() ?? entry.name;
        names[name] = "file";
      }
    }
  }
  return names;
}
export function capturePhase5Trust(
  ctx: StepContext,
  projects: readonly string[],
) {
  const path = join(ctx.scratchDir, "phase5-original-trust.json");
  if (existsSync(path)) return;
  const db = new DatabaseSync(ctx.paths.sqlitePath, { readOnly: true });
  try {
    const resources = db
      .prepare(
        "SELECT path,content_digest,status FROM trusted_resource WHERE kind IN ('agent_profile','subagent_profile','project_capabilities')",
      )
      .all();
    const roots: Data = {};
    for (const root of projects) {
      roots[root] = {};
      for (const [key, names] of Object.entries({
        profiles: ["agent-profiles.json", "subagents.json"],
        capabilities: ["capabilities.json"],
      })) {
        roots[root][key] = names.some((name) => {
          const source = join(root, "config", name);
          safePath(source);
          if (!existsSync(source)) return false;
          const hash = digest(readFileSync(source, "utf8"));
          return resources.some(
            (resource) =>
              resource.path === source &&
              resource.status === "trusted" &&
              (resource.content_digest === hash ||
                resource.content_digest === `sha256:${hash}`),
          );
        });
      }
    }
    writeJson(ctx, path, roots);
  } finally {
    db.close();
  }
}
function applicationBase(
  home: string,
  projectRoot: string,
  originals?: Data,
  trust?: Data,
): Data {
  const user = optional(join(home, "config/harness.json")) ?? defaults;
  const project = optional(join(projectRoot, "config/harness.json")) ?? {};
  const harness = merge(user, project);
  const original = originals?.[projectRoot];
  const projectCaps = original
    ? trust?.[projectRoot]?.capabilities && original.capabilities
      ? convertCapabilities(original.capabilities)
      : undefined
    : optional(join(projectRoot, "config/capabilities.json"));
  const detached = original
    ? projectToolOverrides(original.harness ?? {})
    : undefined;
  const execution = detached
    ? {
        tools: Object.fromEntries(
          Object.entries(detached.tools).filter(
            ([name]) => name === "bash" || name === "python_exec",
          ),
        ),
        skills: {},
      }
    : { tools: {}, skills: {} };
  const userSkills: Data = {
    file: Object.fromEntries(
      (user.skills?.disabled ?? []).map((name: string) => [name, false]),
    ),
    nerve: Object.fromEntries(
      (user.skills?.nerve?.enabled ?? []).map((name: string) => [name, true]),
    ),
    agentBrowser: Object.fromEntries(
      (user.skills?.agentBrowser?.enabled ?? []).map((name: string) => [
        name,
        true,
      ]),
    ),
  };
  return {
    harness,
    capabilities: canonicalCapabilities(
      canonicalCapabilities(
        { tools: user.tools, skills: userSkills },
        projectCaps ?? { tools: {}, skills: {} },
      ),
      execution,
    ),
  };
}

export async function convertPhase5(
  ctx: StepContext,
  projects: readonly string[],
  conversations: readonly string[],
) {
  const roots = [ctx.paths.home, ...projects];
  const catalogs = sourceCatalogs(ctx, roots, conversations);
  const trust =
    optional(join(ctx.scratchDir, "phase5-original-trust.json")) ?? {};
  const configReceipt = join(
    ctx.scratchDir,
    "phase5-configuration-inputs.json",
  );
  const originals =
    optional(configReceipt) ??
    Object.fromEntries(
      roots.map((root) => {
        const paths = ["harness", "integrations", "capabilities"].map((name) =>
          join(root, "config", `${name}.json`),
        );
        return [
          root,
          {
            harness: optional(paths[0]),
            integrations: optional(paths[1]),
            capabilities: optional(paths[2]),
            sourceHashes: Object.fromEntries(
              paths
                .filter(existsSync)
                .map((path) => [path, digest(readFileSync(path, "utf8"))]),
            ),
          },
        ];
      }),
    );
  if (!existsSync(configReceipt)) writeJson(ctx, configReceipt, originals);
  for (const root of roots)
    await ctx.unit(
      {
        kind: "configuration",
        id: join(root, "config/harness.json"),
        title: "Canonical agent settings",
      },
      () => {
        const before = originals[root];
        const outputs: Record<string, unknown> = {};
        const sources: string[] = [];
        const harnessPath = join(root, "config/harness.json");
        const integrationPath = join(root, "config/integrations.json");
        const capsPath = join(root, "config/capabilities.json");
        if (before.harness) sources.push(harnessPath);
        if (before.integrations) sources.push(integrationPath);
        if (before.capabilities) sources.push(capsPath);
        if (root === ctx.paths.home) {
          const harness = convertHarness(
            before.harness ?? { version: 3 },
            before.integrations,
          );
          harness.tools = frozenCapabilitiesSchema.shape.tools.parse(
            harness.tools,
          );
          outputs[harnessPath] = harness;
          if (before.integrations)
            outputs[integrationPath] = convertIntegrations(before.integrations);
          if (before.capabilities)
            outputs[capsPath] = convertCapabilities(before.capabilities);
        } else {
          const accounts = before.integrations?.profiles;
          assert(
            !accounts ||
              Object.values(accounts).every(
                (value) => !Array.isArray(value) || value.length === 0,
              ),
            `Project-owned integration accounts need user review: ${integrationPath}`,
          );
          const projectProviders = optional(
            join(root, "config/providers.json"),
          );
          assert(
            !projectProviders ||
              !(
                projectProviders.providers?.length ||
                projectProviders.models?.length
              ),
            `Project-owned provider/model definitions need user review: ${root}`,
          );
          const harness = structuredClone(before.harness ?? {});
          const detached = projectToolOverrides(harness, before.integrations);
          if (before.harness) {
            harness.version = 4;
            delete harness.execution;
            delete harness.tools;
            delete harness.skills;
            outputs[harnessPath] = harness;
          }
          if (
            before.capabilities ||
            Object.keys(detached.tools).length ||
            Object.values(detached.skills).some(
              (bucket) => Object.keys(bucket as object).length,
            )
          )
            outputs[capsPath] = canonicalCapabilities(
              detached,
              before.capabilities
                ? convertCapabilities(before.capabilities)
                : { tools: {}, skills: {} },
            );
        }
        if (outputs[capsPath])
          outputs[capsPath] = frozenCapabilitiesSchema.parse(outputs[capsPath]);
        for (const path of sources)
          if (existsSync(path)) {
            const bytes = readFileSync(path, "utf8");
            assert(
              digest(bytes) === before.sourceHashes?.[path] ||
                (Object.hasOwn(outputs, path) && bytes === text(outputs[path])),
              `Settings source changed after planning: ${path}`,
            );
          }
        batch(ctx, `settings:${root}`, sources, outputs);
      },
    );
  finishPhase(ctx);
  const userCatalogPath = join(ctx.paths.home, "config/agent-profiles.json");
  for (const root of roots) {
    const source = join(root, "config/agent-profiles.json");
    const entries = catalog(catalogs, source);
    if (!catalogs[source]) continue;
    await ctx.unit(
      { kind: "configuration", id: source, title: "Split profile templates" },
      () => {
        if (existsSync(source))
          assert.equal(
            digest(readFileSync(source, "utf8")),
            catalogs[source].hash,
            `Profile source changed after planning: ${source}`,
          );
        const projectRoot = root === ctx.paths.home ? "" : root;
        const harness = projectRoot
          ? applicationBase(ctx.paths.home, projectRoot).harness
          : (optional(join(root, "config/harness.json")) ?? defaults);
        const outputs: Record<string, unknown> = {};
        for (const name of Object.keys(entries)) {
          const legacy = legacyProfile(
            name,
            root === ctx.paths.home
              ? [entries]
              : [catalog(catalogs, userCatalogPath), entries],
          );
          const converted = convertProfile(
            legacy,
            harness,
            skillKinds(
              ctx.paths.home,
              projectRoot ? dirname(projectRoot) : ctx.paths.home,
            ),
            {
              inheritedCodingPermission:
                entries[name]?.permission === undefined &&
                (root === ctx.paths.home ||
                  catalog(catalogs, userCatalogPath)[name]?.permission ===
                    undefined),
            },
          );
          const validated = frozenProfileFileSchema.parse(converted);
          const target = join(
            root === ctx.paths.home
              ? join(root, "data/agent-profiles")
              : join(root, "agent-profiles"),
            `${name}.json`,
          );
          outputs[target] = validated;
        }
        batch(ctx, `profiles:${source}`, [source], outputs, [source]);
      },
      { quarantine: { files: [source], root } },
    );
  }
  finishPhase(ctx);
  const db = new DatabaseSync(ctx.paths.sqlitePath);
  const updates: { id: string; config: Data }[] = [];
  try {
    const columns = db
      .prepare("PRAGMA table_info(conversation_config)")
      .all()
      .map((row) => String(row.name));
    const profileColumn = columns.includes("agent_profile")
      ? "agent_profile"
      : "mode";
    const rows = db
      .prepare(
        `SELECT c.*, cfg.*, cfg.${profileColumn} AS profile_name, p.directory AS project_directory FROM conversation c JOIN conversation_config cfg ON cfg.conversation_id=c.id JOIN project p ON p.id=c.project_id`,
      )
      .all();
    for (const row of rows) {
      const id = String(row.id);
      if (!conversations.includes(id)) continue;
      await ctx.unit(
        { kind: "conversation", id, title: `Applied profile: ${row.title}` },
        () => {
          const root = join(ctx.paths.home, "data/conversations", id, "config");
          const appliedPath = join(root, "applied-agent-profile.json");
          const receiptPath = join(
            ctx.scratchDir,
            `phase5-conversation-${digest(id)}.json`,
          );
          if (existsSync(receiptPath)) {
            const receipt = record(json(receiptPath));
            for (const path of receipt.sources)
              if (existsSync(path)) {
                const bytes = readFileSync(path, "utf8");
                assert(
                  digest(bytes) === receipt.sourceHashes?.[path] ||
                    (Object.hasOwn(receipt.outputs, path) &&
                      bytes === text(receipt.outputs[path])),
                  `Conversation source changed after planning: ${path}`,
                );
              }
            batch(
              ctx,
              `conversation:${id}`,
              receipt.sources,
              receipt.outputs,
              receipt.remove,
            );
            updates.push({ id, config: receipt.config });
            return;
          }
          if (existsSync(appliedPath)) {
            const applied = record(json(appliedPath));
            assert(
              applied.schemaVersion === 1 && applied.name === row.profile_name,
              "Invalid existing applied profile snapshot",
            );
            return;
          }
          const projectRoot = join(String(row.project_directory), ".nerve");
          const base = applicationBase(
            ctx.paths.home,
            projectRoot,
            originals,
            trust,
          );
          const ownPath = join(root, "capabilities.json");
          const harnessPath = join(root, "harness.json");
          const own = optional(ownPath)
            ? convertCapabilities(json(ownPath))
            : {
                schemaVersion: 3,
                tools: {},
                skills: { file: {}, nerve: {}, agentBrowser: {} },
              };
          let compaction =
            optional(harnessPath)?.compaction ?? base.harness.compaction;
          const conversationCatalog = join(root, "agent-profiles.json");
          const oldConversationCatalog = join(root, "subagents.json");
          if (catalogs[conversationCatalog] && catalogs[oldConversationCatalog])
            assert.deepEqual(
              catalogs[conversationCatalog].document,
              catalogs[oldConversationCatalog].document,
              "Conflicting conversation profile catalogs",
            );
          const projectProfiles = catalog(
            catalogs,
            join(projectRoot, "config/agent-profiles.json"),
          );
          if (
            !row.parent_conversation_id &&
            Object.hasOwn(projectProfiles, String(row.profile_name))
          )
            assert(
              trust[projectRoot]?.profiles,
              `Untrusted active project profile ${row.profile_name}: review before upgrading`,
            );
          const profile = legacyProfile(String(row.profile_name), [
            catalog(catalogs, userCatalogPath),
            projectProfiles,
            catalog(catalogs, oldConversationCatalog),
            catalog(catalogs, conversationCatalog),
          ]);
          assert(
            row.parent_conversation_id || profile.enabled !== false,
            `Disabled active profile ${row.profile_name}: review the prior fallback before upgrading`,
          );
          assert(
            profile.instructions !== undefined || row.parent_conversation_id,
            `Unavailable active profile ${row.profile_name}: review before upgrade`,
          );
          const kinds = skillKinds(
            ctx.paths.home,
            String(row.project_directory),
          );
          let config: Data = {
            model: row.model,
            reasoning_level: row.reasoning_level,
            permission_rule_set_id: row.permission_rule_set_id,
            instructions: row.instructions,
          };
          let capabilities: Data;
          let locked: Data = {};
          if (row.parent_conversation_id) {
            // Child values/instructions were materialized at creation. Never reapply the current source template.
            capabilities = canonicalCapabilities(base.capabilities, own);
            const wasLocked = (value: unknown) =>
              value && typeof value === "object" && "lock" in value;
            if (wasLocked(profile.model))
              locked.model = JSON.parse(config.model);
            if (wasLocked(profile.thinking))
              locked.thinking = config.reasoning_level;
            if (wasLocked(profile.permission))
              locked.permission = config.permission_rule_set_id;
            if (wasLocked(profile.compaction)) locked.compaction = compaction;
          } else {
            const materialized = applyLegacyLive(
              profile,
              config,
              compaction,
              base.capabilities,
              own,
              kinds,
              base.harness,
            );
            config = materialized.config;
            capabilities = materialized.capabilities;
            compaction = materialized.compaction;
            locked = materialized.locked;
          }
          const instructions = row.parent_conversation_id
            ? String(row.instructions ?? "")
            : String(profile.instructions ?? "");
          if (row.parent_conversation_id) config.instructions = null;
          const outputs: Record<string, unknown> = {
            [appliedPath]: frozenAppliedSchema.parse({
              schemaVersion: 1,
              name: row.profile_name,
              instructions,
              locked,
            }),
            [ownPath]: frozenCapabilitiesSchema.parse(capabilities),
            [harnessPath]: { compaction },
          };
          if (catalogs[conversationCatalog] || catalogs[oldConversationCatalog])
            outputs[join(root, "retired-agent-profiles.json")] = (
              catalogs[conversationCatalog] ?? catalogs[oldConversationCatalog]
            ).document;
          const sources = [
            ownPath,
            harnessPath,
            conversationCatalog,
            oldConversationCatalog,
          ].filter((path) => existsSync(path));
          const remove = [conversationCatalog, oldConversationCatalog].filter(
            (path) => catalogs[path],
          );
          writeJson(ctx, receiptPath, {
            config,
            outputs,
            sources,
            remove,
            sourceHashes: Object.fromEntries(
              sources.map((path) => [path, digest(readFileSync(path, "utf8"))]),
            ),
          });
          batch(ctx, `conversation:${id}`, sources, outputs, remove);
          updates.push({ id, config });
        },
      );
    }
    finishPhase(ctx);
    db.exec("BEGIN IMMEDIATE");
    for (const { id, config } of updates)
      db.prepare(
        "UPDATE conversation_config SET model=?,reasoning_level=?,permission_rule_set_id=?,instructions=? WHERE conversation_id=?",
      ).run(
        config.model,
        config.reasoning_level,
        config.permission_rule_set_id,
        config.instructions,
        id,
      );
    for (const row of db
      .prepare(
        "SELECT t.id,t.conversation_id,t.interaction,c.project_id,p.directory FROM tool_call t JOIN conversation c ON c.id=t.conversation_id JOIN project p ON p.id=c.project_id WHERE t.interaction IS NOT NULL",
      )
      .all()) {
      const interaction = record(JSON.parse(String(row.interaction)));
      if (
        interaction.kind === "plan_review" &&
        interaction.request &&
        !interaction.request.approvalProfile
      ) {
        const capabilities = optional(
          join(
            ctx.paths.home,
            "data/conversations",
            String(row.conversation_id),
            "config/capabilities.json",
          ),
        );
        interaction.request.approvalProfile =
          capabilities?.tools?.plan_present?.settings?.approvalProfile ??
          defaults.tools.plan_present.settings.approvalProfile;
        db.prepare("UPDATE tool_call SET interaction=? WHERE id=?").run(
          JSON.stringify(interaction),
          row.id,
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
  finishPhase(ctx);
}
export function verifyPhase5(
  ctx: StepContext,
  projects: readonly string[],
  conversations: readonly string[],
) {
  for (const name of readdirSync(ctx.scratchDir).filter(
    (name) => name.startsWith("phase5-") && name.endsWith(".json"),
  )) {
    const receipt = record(json(join(ctx.scratchDir, name)));
    if (receipt.targets)
      for (const [path, expected] of Object.entries(receipt.targets))
        assert.deepEqual(
          json(path),
          expected,
          `Changed phase-5 output: ${path}`,
        );
  }
  for (const root of [ctx.paths.home, ...projects]) {
    const aggregate = join(root, "config/agent-profiles.json");
    if (ctx.discarded.has(aggregate)) continue;
    assert(
      !existsSync(aggregate),
      `Aggregate profile document remains: ${aggregate}`,
    );
    const directory =
      root === ctx.paths.home
        ? join(root, "data/agent-profiles")
        : join(root, "agent-profiles");
    safePath(directory);
    if (existsSync(directory))
      for (const name of readdirSync(directory).filter((name) =>
        name.endsWith(".json"),
      )) {
        const profile = frozenProfileFileSchema.parse(
          json(join(directory, name)),
        );
        assert.equal(name, `${profile.name}.json`);
      }
    const harness = optional(join(root, "config/harness.json"));
    if (harness) {
      assert.equal(harness.version, 4);
      assert(!harness.execution);
      if (root !== ctx.paths.home) assert(!harness.tools && !harness.skills);
      else frozenCapabilitiesSchema.shape.tools.parse(harness.tools);
    }
    const capabilities = optional(join(root, "config/capabilities.json"));
    if (capabilities) frozenCapabilitiesSchema.parse(capabilities);
  }
  for (const id of conversations)
    if (!ctx.discarded.has(id)) {
      const root = join(ctx.paths.home, "data/conversations", id, "config");
      assert(
        !existsSync(join(root, "agent-profiles.json")) &&
          !existsSync(join(root, "subagents.json")),
        `Conversation template catalogs remain: ${id}`,
      );
      frozenAppliedSchema.parse(json(join(root, "applied-agent-profile.json")));
      frozenCapabilitiesSchema.parse(json(join(root, "capabilities.json")));
    }
}
