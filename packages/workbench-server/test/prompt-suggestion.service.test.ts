import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts";
import { PromptSuggestionEnablementRepository } from "../src/domains/prompt-suggestions/prompt-suggestion-enablement.repository.js";
import { PromptSuggestionService } from "../src/domains/prompt-suggestions/prompt-suggestion.service.js";
import type { InitializedStorage } from "../src/infrastructure/storage/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nerve-prompt-suggestions-"));
  roots.push(root);
  const home = join(root, "home");
  const projectDir = join(root, "project");
  const project = {
    id: "proj_test",
    name: "Test project",
    dir: projectDir,
  } as ProjectRecord;
  const storage = { paths: { home } } as InitializedStorage;
  const events: Array<{ type: string; payload: unknown }> = [];
  const service = new PromptSuggestionService({
    storage,
    enablementRepository: new PromptSuggestionEnablementRepository(storage),
    trustRepository: {
      hydrateIndex: async () => undefined,
      list: async () => [],
      remove: async () => undefined,
      set: async () => undefined,
    } as never,
    events: {
      publish: async (type: string, payload: unknown) => {
        events.push({ type, payload });
      },
    } as never,
    git: {
      discoverRepos: async () => ({
        projectIsRepo: true,
        repos: [
          {
            relativePath: ".",
            absDir: projectDir,
            name: "project",
            isRepo: true,
            currentBranch: "main",
            detached: false,
            ahead: 0,
            behind: 0,
            hasUpstream: true,
            hasRemote: false,
            hasGithubRemote: false,
            baseBranch: "main",
            onBaseBranch: true,
            mergedToBase: true,
            dirty: true,
            changeCount: 2,
          },
        ],
      }),
    } as never,
    getProject: () => project,
    listProjects: () => [project],
    getConversation: () => {
      throw new Error("not used");
    },
    getAgent: () => {
      throw new Error("not used");
    },
  });
  return { service, home, project, events };
}

describe("PromptSuggestionService", () => {
  it("lists and evaluates the built-in Git suggestions", async () => {
    const { service, project } = await fixture();

    const statuses = await service.listStatuses(project.id);
    assert.deepEqual(
      statuses
        .filter((status) => status.sourceKind === "builtin")
        .map((status) => status.name),
      ["commit-changes", "commit-on-feature-branch", "create-pull-request"],
    );
    assert.ok(statuses.every((status) => status.enabled));

    const result = await service.listForProject(project.id);
    assert.deepEqual(
      result.suggestions.map((suggestion) => suggestion.name),
      ["commit-changes", "commit-on-feature-branch"],
    );
    assert.match(result.suggestions[0].prompt, /git status --short --branch/);
  });

  it("persists per-suggestion enablement and publishes an event", async () => {
    const { service, home, project, events } = await fixture();

    await service.updateEnabled({
      definitionKey: "builtin:commit-changes",
      enabled: false,
    });

    const status = (await service.listStatuses(project.id)).find(
      (candidate) => candidate.definitionKey === "builtin:commit-changes",
    );
    const database = new DatabaseSync(join(home, "data", "nerve.sqlite"));
    const enabled = database
      .prepare(
        `SELECT data FROM domain_documents
         WHERE namespace = 'prompt_suggestion_enablement'
           AND document_id = 'builtin:commit-changes'`,
      )
      .get() as { data: Uint8Array };
    database.close();
    assert.match(
      Buffer.from(enabled.data).toString("utf8"),
      /builtin:commit-changes/,
    );
    assert.equal(status?.enabled, false);
    assert.equal(events.at(-1)?.type, "prompt_suggestions.enabled_updated");
  });

  it("reports malformed user suggestion YAML without hiding built-ins", async () => {
    const { service, home, project } = await fixture();
    await mkdir(join(home, "agent", "suggestions"), { recursive: true });
    await writeFile(
      join(home, "agent", "suggestions", "broken.md"),
      "---\nname: [\n---\nPrompt body\n",
    );

    const result = await service.listForProject(project.id);

    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "parse_failed",
      ),
    );
    assert.ok(
      result.suggestions.some(
        (suggestion) => suggestion.name === "commit-changes",
      ),
    );
  });

  it("creates loadable user suggestions without overwriting and reports precedence", async () => {
    const { service, home, project, events } = await fixture();
    const request = {
      scope: "user" as const,
      name: "commit-changes",
      label: "Review and commit",
      description: "A custom replacement.",
      prompt: "Review the changes, then commit them.",
    };

    const created = await service.create(request);
    assert.equal(created.definitionKey, "user:commit-changes");
    assert.match(
      await readFile(
        join(home, "agent", "suggestions", "commit-changes.md"),
        "utf8",
      ),
      /Review the changes, then commit them\./,
    );
    await assert.rejects(() => service.create(request), /already exists/);

    const statuses = await service.listStatuses(project.id);
    assert.equal(
      statuses.find(
        (status) => status.definitionKey === "builtin:commit-changes",
      )?.overriddenBy,
      "user",
    );
    const result = await service.listForProject(project.id);
    assert.equal(
      result.suggestions.find(
        (suggestion) => suggestion.name === "commit-changes",
      )?.label,
      "Review and commit",
    );
    assert.equal(events[0]?.type, "prompt_suggestions.created");
  });
});
