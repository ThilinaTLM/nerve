import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineStep, type StepContext } from "../../framework/step.js";
import { renameSecrets, reshapeAccounts } from "./accounts.js";
import {
  convertConversationAgent,
  convertProfileDefinition,
  convertUserAgent,
  hasMovedFields,
  isRecord,
  mergeEntries,
  type Entries,
  type Json,
} from "./convert.js";
import {
  convertPermissionOverlayDocument,
  convertRuleSetDocument,
  hasEnabledRemovedToolRule,
} from "./removed-tools.js";

/**
 * Extension settings: integration accounts move to `config/accounts.json`,
 * reshaped by kind (`{ accounts: { <kind>: [{ id, name, fields }] } }`), and
 * their secrets are renamed to `account:<kind>:<id>` in the secret store
 * (`secrets/credentials.enc`, rewritten in the same journaled unit). Account
 * choices and tool options leave agent
 * configuration for `extensions.json` at the same scope:
 *
 * - user `config/agent.json` → user `config/extensions.json`
 * - each conversation's `config/agent.json` (lead overrides, child frozen
 *   defaults and overrides) → the conversation's `config/extensions.json`
 * - applied profile snapshots and user profile definitions → their `extensions` section
 *
 * The direct tools that `quick_script` namespaces replaced (`jira_*`,
 * `confluence_*`, `generate_image`, `kroki_export`) leave tool entries, and
 * permission rules that name them (user and conversation overlays, custom
 * rule sets) are rewritten to `quick_script` operations; a rule that cannot
 * be converted is disabled and reported.
 *
 * Project files are not touched: project chains convert lazily.
 */

const text = (path: string): string => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`Expected a regular file: ${path}`);
  return readFileSync(path, "utf8");
};
const readObject = (path: string): Json => {
  const value: unknown = JSON.parse(text(path));
  if (!isRecord(value)) throw new Error("Expected a JSON object");
  return value;
};
const serialize = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

type Target = {
  path: string;
  kind:
    | "user-agent"
    | "profile"
    | "conversation-agent"
    | "permissions"
    | "rule-set";
  /** The scope's `extensions.json`. */
  extensions?: string;
};

function targets(context: StepContext): Target[] {
  const { paths } = context;
  const found: Target[] = [];
  const agent = join(paths.configPath, "agent.json");
  if (existsSync(agent))
    found.push({
      path: agent,
      kind: "user-agent",
      extensions: join(paths.configPath, "extensions.json"),
    });
  if (existsSync(paths.permissionsConfigPath))
    found.push({ path: paths.permissionsConfigPath, kind: "permissions" });
  const ruleSets = join(paths.configPath, "rule-sets");
  if (existsSync(ruleSets))
    for (const file of readdirSync(ruleSets).sort())
      if (file.endsWith(".json"))
        found.push({ path: join(ruleSets, file), kind: "rule-set" });
  if (existsSync(paths.agentProfilesConfigPath))
    for (const file of readdirSync(paths.agentProfilesConfigPath).sort())
      if (file.endsWith(".json"))
        found.push({
          path: join(paths.agentProfilesConfigPath, file),
          kind: "profile",
        });
  if (existsSync(paths.conversationsPath))
    for (const id of readdirSync(paths.conversationsPath).sort()) {
      const directory = join(paths.conversationsPath, id, "config");
      const path = join(directory, "agent.json");
      if (existsSync(path))
        found.push({
          path,
          kind: "conversation-agent",
          extensions: join(directory, "extensions.json"),
        });
      const permissions = join(directory, "permissions.json");
      if (existsSync(permissions))
        found.push({ path: permissions, kind: "permissions" });
    }
  return found;
}

/** The user-visible home paths this step may replace. */
function owned(context: StepContext): string[] {
  const { paths } = context;
  return [
    join(paths.configPath, "integrations.json"),
    paths.accountsConfigPath,
    paths.credentialsPath,
    ...targets(context).flatMap((target) => [
      target.path,
      ...(target.extensions ? [target.extensions] : []),
    ]),
  ];
}

function extensionsDocument(entries: Entries, existing?: Json): Json {
  const stored = isRecord(existing?.extensions)
    ? (existing.extensions as Entries)
    : {};
  // Anything already in the file (a newer setting saved before the upgrade ran) wins.
  return {
    schemaVersion: 1,
    revision: typeof existing?.revision === "number" ? existing.revision : 1,
    extensions: mergeEntries(entries, stored),
  };
}

function convert(context: StepContext, target: Target): void {
  const losses = new Map<string, number>();
  const loss = (reason: string) =>
    losses.set(reason, (losses.get(reason) ?? 0) + 1);
  const source = readObject(target.path);
  let document: Json;
  let entries: Entries = {};
  if (target.kind === "permissions" || target.kind === "rule-set") {
    const converted = (
      target.kind === "permissions"
        ? convertPermissionOverlayDocument
        : convertRuleSetDocument
    )(source, loss);
    if (converted.changed)
      context.fs.write(target.path, serialize(converted.document));
    for (const [reason, count] of losses) context.loss(reason, count);
    return;
  }
  if (target.kind === "profile")
    document = convertProfileDefinition(source, loss);
  else {
    const converted =
      target.kind === "user-agent"
        ? convertUserAgent(source, loss)
        : convertConversationAgent(source, loss);
    document = converted.document;
    entries = converted.entries;
  }
  if (JSON.stringify(document) !== JSON.stringify(source))
    context.fs.write(target.path, serialize(document));
  if (target.extensions && Object.keys(entries).length) {
    const existing = existsSync(target.extensions)
      ? readObject(target.extensions)
      : undefined;
    context.fs.write(
      target.extensions,
      serialize(extensionsDocument(entries, existing)),
    );
  }
  for (const [reason, count] of losses) context.loss(reason, count);
}

export default defineStep({
  id: "0005-extension-settings",
  description: "Move account and tool options to extensions",
  ownedPaths: (context) => owned(context),
  async run(context) {
    const { paths } = context;
    const legacy = join(paths.configPath, "integrations.json");
    if (existsSync(legacy)) {
      await context.unit({ kind: "configuration", id: legacy }, () => {
        if (existsSync(paths.accountsConfigPath))
          context.loss(
            "config/integrations.json was left in place: config/accounts.json already exists",
          );
        else context.fs.rename(legacy, paths.accountsConfigPath);
      });
    }
    if (existsSync(paths.accountsConfigPath)) {
      if (context.discarded.has(paths.accountsConfigPath))
        context.quarantine(
          {
            kind: "configuration",
            id: paths.accountsConfigPath,
            reason: "Set aside at user request after an upgrade failure",
          },
          { files: [paths.accountsConfigPath], retainSource: true },
        );
      else
        await context.unit(
          { kind: "configuration", id: paths.accountsConfigPath },
          () => {
            const converted = reshapeAccounts(
              readObject(paths.accountsConfigPath),
              (reason) => context.loss(reason),
            );
            if (!converted) return;
            context.fs.write(
              paths.accountsConfigPath,
              serialize(converted.document),
            );
            const secrets = renameSecrets(
              paths.credentialsPath,
              paths.masterKeyPath,
              converted.renames,
            );
            if (secrets)
              context.fs.write(paths.credentialsPath, secrets.content);
          },
        );
    }
    const all = targets(context);
    context.progress("run", 0, all.length, "Moving extension settings");
    let done = 0;
    for (const target of all) {
      if (context.discarded.has(target.path))
        context.quarantine(
          {
            kind: "configuration",
            id: target.path,
            reason: "Set aside at user request after an upgrade failure",
          },
          { files: [target.path], retainSource: true },
        );
      else
        await context.unit({ kind: "configuration", id: target.path }, () =>
          convert(context, target),
        );
      context.progress("run", ++done, all.length);
    }
  },
  async verify(context) {
    const { paths } = context;
    if (
      existsSync(join(paths.configPath, "integrations.json")) &&
      !existsSync(paths.accountsConfigPath)
    )
      throw new Error("Integration accounts were not moved to accounts.json");
    if (
      existsSync(paths.accountsConfigPath) &&
      !context.discarded.has(paths.accountsConfigPath) &&
      isRecord(readObject(paths.accountsConfigPath).profiles)
    )
      throw new Error("Accounts were not reshaped by kind");
    for (const target of targets(context)) {
      if (context.discarded.has(target.path)) continue;
      const document = readObject(target.path);
      if (target.kind === "permissions" || target.kind === "rule-set") {
        if (hasEnabledRemovedToolRule(document))
          throw new Error(`Removed tools remain in ${target.path}`);
        continue;
      }
      const sections =
        target.kind === "profile"
          ? [document.recommendations, document.requirements]
          : [
              document.overrides,
              document.frozenDefaults,
              ...(isRecord(document.appliedProfile)
                ? [
                    document.appliedProfile.recommendations,
                    document.appliedProfile.requirements,
                  ]
                : []),
            ];
      for (const section of sections)
        if (isRecord(section) && hasMovedFields(section.tools))
          throw new Error(`Moved settings remain in ${target.path}`);
      if (target.extensions && existsSync(target.extensions)) {
        const extensions = readObject(target.extensions);
        if (
          extensions.schemaVersion !== 1 ||
          typeof extensions.revision !== "number" ||
          !isRecord(extensions.extensions)
        )
          throw new Error(`Invalid extension settings: ${target.extensions}`);
      }
    }
  },
});
