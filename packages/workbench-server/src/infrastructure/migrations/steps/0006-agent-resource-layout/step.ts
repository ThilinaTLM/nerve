import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { migrate, openCoreDatabase } from "@nervekit/conversation-core";
import { dropLaunchToolDocument, hasLaunchToolRule } from "./launch-tool.js";
import { defineStep, type StepContext } from "../../framework/step.js";
import {
  accountRows,
  readSecretStore,
  withoutAccountSecrets,
} from "./accounts.js";

/**
 * User agent profiles move from `data/agent-profiles/` to `agent/agent-profiles/`, the one
 * place every authored user resource lives (docs/architecture/storage.md, "Home layout").
 * `data/` is Nerve-owned state; authored resources do not belong there.
 *
 * The trust table rebuild that belongs to the same release (`trusted_resource` v3) is a core SQL
 * migration (`schema-v4.ts` in conversation-core), applied when the core opens the database.
 *
 * Accounts move from `config/accounts.json` and `secrets/credentials.enc` into the `account` table
 * (core schema v5) as user-level accounts, each secret sealed into the account's `credential`
 * (docs/architecture/storage.md, "Accounts"). Home steps run before the core opens the database,
 * so this step brings the database to the current core schema itself (the same SQL migrations
 * the core would apply) before inserting. The rows are written first, then the secrets leave
 * `credentials.enc` and `accounts.json` is removed; a rerun after a partial failure replaces the
 * rows it already wrote.
 *
 * The removed direct `launch` tool leaves permission rules: user and conversation overlays and
 * custom rule sets drop the name (a rule naming only it is removed) and report each as a loss.
 * Permission exceptions are not persisted in the home, so nothing else names the tool.
 *
 * Merge-safe: a profile that already exists in the target, whatever its content, wins. The
 * source of a different one is quarantined and reported; an identical one is simply removed.
 */

/** The legacy and the new location of user profiles. */
function locations(context: StepContext) {
  return {
    legacy: context.paths.agentProfilesConfigPath,
    target: context.paths.agentProfilesPath,
  };
}

function sameBytes(a: string, b: string): boolean {
  const left = lstatSync(a);
  const right = lstatSync(b);
  return (
    left.isFile() &&
    right.isFile() &&
    left.size === right.size &&
    readFileSync(a).equals(readFileSync(b))
  );
}

function pending(context: StepContext): string[] {
  const { legacy } = locations(context);
  return existsSync(legacy) ? readdirSync(legacy).sort() : [];
}

/** `config/accounts.json` and the account secrets become rows of the `account` table. */
async function moveAccounts(context: StepContext): Promise<void> {
  const { paths } = context;
  if (!existsSync(paths.accountsConfigPath)) return;
  await context.unit(
    { kind: "configuration", id: paths.accountsConfigPath },
    () => {
      const document: unknown = JSON.parse(
        readFileSync(paths.accountsConfigPath, "utf8"),
      );
      const store = readSecretStore(paths.credentialsPath, paths.masterKeyPath);
      const rows = accountRows(document, store, (reason) =>
        context.loss(reason),
      );
      const now = new Date().toISOString();
      mkdirSync(dirname(paths.sqlitePath), { recursive: true });
      const db = openCoreDatabase(paths.sqlitePath);
      try {
        migrate(db);
        const insert = db.sqlite.prepare(
          "INSERT OR REPLACE INTO account (id, kind, project_id, name, fields, credential, status, expires_at, last_used_at, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?)",
        );
        db.transaction(() => {
          for (const row of rows)
            insert.run(
              row.id,
              row.kind,
              row.name,
              row.fields,
              row.credential,
              row.status,
              now,
              now,
            );
        });
      } finally {
        db.close();
      }
      const remaining = store && withoutAccountSecrets(store);
      if (remaining) context.fs.write(paths.credentialsPath, remaining);
      context.fs.remove(paths.accountsConfigPath);
    },
    { quarantine: { files: [paths.accountsConfigPath] } },
  );
}

/** The parsed file, or undefined when it is not valid JSON (the policy loader reports those). */
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Permission files (user and conversation overlays, custom rule sets) that may name the removed launch tool. */
function permissionFiles(context: StepContext): string[] {
  const { paths } = context;
  const found: string[] = [];
  if (existsSync(paths.permissionsConfigPath))
    found.push(paths.permissionsConfigPath);
  const ruleSets = join(paths.configPath, "rule-sets");
  if (existsSync(ruleSets))
    for (const file of readdirSync(ruleSets).sort())
      if (file.endsWith(".json")) found.push(join(ruleSets, file));
  if (existsSync(paths.conversationsPath))
    for (const id of readdirSync(paths.conversationsPath).sort()) {
      const path = join(
        paths.conversationsPath,
        id,
        "config",
        "permissions.json",
      );
      if (existsSync(path)) found.push(path);
    }
  return found;
}

/** Drops the removed `launch` tool from permission rules, reporting each. */
async function dropLaunchTool(context: StepContext): Promise<void> {
  for (const path of permissionFiles(context)) {
    if (context.discarded.has(path)) continue;
    await context.unit({ kind: "configuration", id: path }, () => {
      const document = readJson(path);
      if (document === undefined) return;
      const dropped = dropLaunchToolDocument(document, (reason) =>
        context.loss(reason),
      );
      if (dropped.changed)
        context.fs.write(
          path,
          `${JSON.stringify(dropped.document, null, 2)}\n`,
        );
    });
  }
}

export default defineStep({
  id: "0006-agent-resource-layout",
  description:
    "Move user agent profiles to the agent folder, accounts to the database, and drop launch-tool permission rules",
  ownedPaths: (context) => [
    context.paths.accountsConfigPath,
    context.paths.credentialsPath,
    ...permissionFiles(context),
  ],
  async run(context) {
    const { legacy, target } = locations(context);
    const names = pending(context);
    context.progress("run", 0, names.length, "Moving agent profiles");
    let done = 0;
    for (const name of names) {
      const source = join(legacy, name);
      const destination = join(target, name);
      await context.unit(
        { kind: "configuration", id: source },
        () => {
          if (!existsSync(destination)) {
            context.fs.mkdir(target);
            context.fs.move(source, destination);
          } else if (sameBytes(source, destination)) context.fs.remove(source);
          else {
            context.quarantine(
              {
                kind: "configuration",
                id: source,
                reason: `agent/agent-profiles already has ${name}; kept it and set this older copy aside`,
              },
              { files: [source] },
            );
            context.loss(
              "A user agent profile with the same name already existed in agent/agent-profiles; the existing one was kept",
            );
          }
        },
        { quarantine: { files: [source] } },
      );
      context.progress("run", ++done, names.length);
    }
    if (existsSync(legacy) && readdirSync(legacy).length === 0)
      context.fs.remove(legacy);
    await moveAccounts(context);
    await dropLaunchTool(context);
  },
  async verify(context) {
    for (const path of permissionFiles(context))
      if (!context.discarded.has(path) && hasLaunchToolRule(readJson(path)))
        throw new Error(`The removed launch tool remains in ${path}`);
    const { accountsConfigPath } = context.paths;
    if (
      existsSync(accountsConfigPath) &&
      !context.discarded.has(accountsConfigPath)
    )
      throw new Error("config/accounts.json was not moved to the database");
    const { legacy } = locations(context);
    const left = pending(context).filter(
      (name) => !context.discarded.has(join(legacy, name)),
    );
    if (left.length)
      throw new Error(
        `${left.length} agent profiles remain in data/agent-profiles`,
      );
  },
});
