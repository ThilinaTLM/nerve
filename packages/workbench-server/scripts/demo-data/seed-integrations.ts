/**
 * Seeds Aurora's extensions, the user's MCP servers and the skills, through the services
 * Settings uses. See `seed-demo-home.ts`, which calls these.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { toTrustedDigest } from "@nervekit/contracts/core";
import type { composeServerRuntime } from "../../src/app/runtime/server-runtime.js";
import { createProjectSkillTrust } from "../../src/core-host/resources/project-skill-trust.js";
import { hashExtensionContent } from "../../src/core-host/extensions/extension-catalog/content-hash.js";
import { McpCatalog } from "../../src/domains/mcp/mcp-catalog.js";
import { resolveMcpServer } from "../../src/domains/mcp/mcp-config.js";
import { indexKeyOf } from "../../src/domains/mcp/mcp-hub-support.js";
import { McpToolIndex } from "../../src/domains/mcp/mcp-tool-index.js";
import {
  ENV_STATUS_DATA,
  ENV_STATUS_EXTENSION,
  ENV_STATUS_PANEL,
  ENV_STATUS_TEST,
  STATUS_PAGE_EXTENSION,
} from "./env-status-extension.js";
import { DEMO_MCP_SERVERS, DEMO_MCP_TOOLS } from "./mcp-servers.js";
import { DEMO_PROJECT_SKILLS, DEMO_USER_SKILLS } from "./skills.js";

type Services = ReturnType<typeof composeServerRuntime>["services"];

const run = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const EXTENSION_SDK = join(REPO_ROOT, "packages/extension-sdk");

/**
 * Scaffolds a project extension with the SDK's own `nerve-ext init`, lets `edit` replace the
 * sample files, and builds `dist/` with `nerve-ext build`. The SDK resolves through a link to the
 * workspace package, so seeding needs no network and no install.
 */
async function buildProjectExtension(
  workspace: string,
  id: string,
  kind: string,
  edit: (folder: string) => Promise<void>,
): Promise<string> {
  const cli = join(EXTENSION_SDK, "bin", "nerve-ext.js");
  if (!existsSync(join(EXTENSION_SDK, "dist", "cli.js")))
    throw new Error(
      "The extension SDK is not built. Run `pnpm --filter @nervekit/extension-sdk build` first.",
    );
  const folder = join(workspace, ".nerve", "extensions", id);
  await rm(folder, { recursive: true, force: true });
  await run("node", [cli, "init", id, "--kind", kind, "--dir", folder]);
  await edit(folder);
  const modules = join(folder, "node_modules", "@nervekit");
  await mkdir(modules, { recursive: true });
  await symlink(EXTENSION_SDK, join(modules, "extension-sdk"), "dir");
  await run("node", [cli, "build"], { cwd: folder });
  return folder;
}

async function writeFiles(
  folder: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const path = join(folder, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
}

/**
 * Two project extensions in Aurora: `env-status` (the Environments panel) is built and allowed
 * through the same consent path as Settings → Extensions; `status-page` is built and left
 * unreviewed, so Settings shows its review. Nothing contacts the network.
 */
export async function seedProjectExtensions(
  services: Services,
  workspace: string,
): Promise<void> {
  const panel = "src/panels/environments";
  const envStatus = await buildProjectExtension(
    workspace,
    "env-status",
    "panel",
    async (folder) => {
      await rm(join(folder, "src/panels/checklist"), { recursive: true });
      await writeFiles(folder, {
        "src/extension.ts": ENV_STATUS_EXTENSION,
        [`${panel}/environments.ts`]: ENV_STATUS_DATA,
        [`${panel}/Environments.svelte`]: ENV_STATUS_PANEL,
        [`${panel}/environments.test.ts`]: ENV_STATUS_TEST,
      });
    },
  );
  await buildProjectExtension(
    workspace,
    "status-page",
    "integration",
    async (folder) => {
      await writeFiles(folder, { "src/extension.ts": STATUS_PAGE_EXTENSION });
    },
  );
  const outcome = await services.extensionCatalog.grantConsent(
    { source: "project", id: "env-status", projectDir: workspace },
    await hashExtensionContent(envStatus),
  );
  if (outcome !== "granted")
    throw new Error(`Could not allow the env-status extension: ${outcome}`);
  const entries = await services.extensionCatalog.entries(workspace);
  for (const [id, state] of [
    ["env-status", "enabled"],
    ["status-page", "pending_consent"],
  ] as const) {
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry?.state !== state)
      throw new Error(
        `Extension ${id} should be ${state}, found ${entry?.state ?? "missing"}`,
      );
  }
}

/**
 * The user's two MCP servers, saved through the same service as Settings → MCP servers (so each
 * is approved), plus their tool lists in the tool index. The commands are never started: Nerve
 * reads the cached list, so the page shows tool counts and no error.
 */
export async function seedMcpServers(
  services: Services,
  home: string,
  projectDirectories: readonly string[],
): Promise<void> {
  for (const server of DEMO_MCP_SERVERS) {
    const saved = await services.mcpService.save({
      target: { scope: "user" },
      name: server.name,
      entry: server.entry,
      secrets: server.secrets,
    });
    if (saved.status !== "saved")
      throw new Error(`Could not save MCP server ${server.name}`);
  }
  const catalog = new McpCatalog({
    home,
    trust: {
      state: (kind, projectId, key, digest) =>
        services.conversationCore.trust.state(kind, projectId, key, digest),
    },
  });
  const index = new McpToolIndex({
    cacheDirectory: join(home, "cache", "mcp"),
  });
  const view = await catalog.load();
  for (const server of view.user.servers) {
    const entry = catalog.entry("user", undefined, server);
    const secrets = Object.fromEntries(
      DEMO_MCP_SERVERS.flatMap((demo) => Object.keys(demo.secrets)).map(
        (name) => [name, "demo"],
      ),
    );
    const resolved = resolveMcpServer(
      entry.server,
      homedir(),
      { env: process.env, secrets },
      "Settings",
    );
    // A stdio server's tools are indexed per directory: Settings reads them from the open project.
    for (const directory of [homedir(), ...projectDirectories])
      await index.set(
        indexKeyOf(entry, resolved, directory),
        (DEMO_MCP_TOOLS[server.name] ?? []).map((tool) => ({
          server: server.name,
          ...tool,
        })),
      );
  }
}

/**
 * One personal skill, and Aurora's team skills in the three trust states Settings → Skills
 * shows: approved and declined through the trust service, one left for review.
 */
export async function seedSkills(
  services: Services,
  home: string,
  projectId: string,
  workspace: string,
): Promise<void> {
  for (const skill of DEMO_USER_SKILLS)
    await writeFiles(join(home, "agent", "skills", skill.name), skill.files);
  const skillTrust = createProjectSkillTrust(services.conversationCore.trust);
  for (const skill of DEMO_PROJECT_SKILLS) {
    const folder = join(workspace, ".nerve", "skills", skill.name);
    await writeFiles(folder, skill.files);
    if (skill.decision === "needs_review") continue;
    const review = await skillTrust.review(projectId, {
      name: skill.name,
      description: skill.description,
      content: "",
      filePath: join(folder, "SKILL.md"),
    });
    services.conversationCore.trust.decide({
      kind: "project_skill",
      projectId,
      resourceKey: folder,
      name: skill.name,
      contentDigest: toTrustedDigest(review.contentDigest),
      status: skill.decision === "trusted" ? "trusted" : "rejected",
    });
  }
}
