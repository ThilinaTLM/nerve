import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { SubagentProfileDraft } from "@nervekit/contracts/subagents";
import {
  SubagentEnablementService,
  SubagentProfileService,
  subagentCompactionToSettings,
} from "../../../src/domains/subagents/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

type Trust = { path: string; digest: string; id: string };

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "nerve-subagents-"));
  roots.push(root);
  const projectDir = join(root, "project");
  await mkdir(projectDir, { recursive: true });
  const trusted: Trust[] = [];
  const published: Array<{ type: string; data: unknown }> = [];
  const service = new SubagentProfileService({
    userDir: join(root, "home/agent/subagents"),
    enablement: new SubagentEnablementService(
      join(root, "home/config/subagents.json"),
    ),
    trust: {
      isTrusted: (_kind, _projectId, path, digest) =>
        trusted.some((item) => item.path === path && item.digest === digest),
      decide: (input) => {
        const index = trusted.findIndex((item) => item.path === input.path);
        if (index >= 0) trusted.splice(index, 1);
        trusted.push({
          path: input.path,
          digest: input.contentDigest,
          id: `trust_${trusted.length}`,
        });
        return input as never;
      },
      list: () =>
        trusted.map((item) => ({ ...item, path: item.path }) as never),
      delete: (id) => {
        const index = trusted.findIndex((item) => item.id === id);
        if (index >= 0) trusted.splice(index, 1);
      },
    },
    events: {
      publish: async (type, data) => {
        published.push({ type, data });
      },
    },
    getProject: (id) => ({ id, directory: projectDir }),
  });
  return { root, projectDir, service, trusted, published };
}

const profileFile = (description: string, extra = "") =>
  `---\ndescription: ${description}\nmodel: lead\nthinking: lead\npermission: read_only\ncompaction: inherit\nskills: none\n${extra}---\n\nBe careful.\n`;

async function writeProfile(dir: string, name: string, content: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.md`), content);
}

const draft = (
  name: string,
  description = "A profile",
): SubagentProfileDraft => ({
  name,
  description,
  model: "lead",
  thinking: "lead",
  permission: "autonomous",
  compaction: "inherit",
  skills: "inherit",
  instructions: "Work carefully.",
});

const PROJECT_ID = "proj_one";

describe("SubagentProfileService", () => {
  it("lists built-ins and applies project > user > built-in precedence with shadowing", async () => {
    const { root, projectDir, service } = await setup();
    await writeProfile(
      join(root, "home/agent/subagents"),
      "explore",
      profileFile("User explore"),
    );
    await writeProfile(
      join(projectDir, ".nerve/subagents"),
      "explore",
      profileFile("Project explore"),
    );
    await writeProfile(
      join(root, "home/agent/subagents"),
      "reviewer",
      profileFile("Reviews"),
    );

    const profiles = await service.list(PROJECT_ID);
    const explore = profiles.filter((profile) => profile.name === "explore");
    assert.deepEqual(
      explore.map((profile) => [profile.source, profile.shadowed ?? false]),
      [
        ["project", false],
        ["user", true],
        ["builtin", true],
      ],
    );
    assert.equal(explore[0]?.description, "Project explore");
    assert.equal(explore[0]?.trust, "untrusted");
    assert.equal(
      profiles.find((profile) => profile.name === "reviewer")?.trust,
      undefined,
    );
    // Without a project the user file is effective.
    const noProject = await service.list();
    assert.equal(
      noProject.find(
        (profile) => profile.name === "explore" && !profile.shadowed,
      )?.source,
      "user",
    );
  });

  it("reports invalid files with an error, keeps them authoritative and never offers them", async () => {
    const { root, service } = await setup();
    const dir = join(root, "home/agent/subagents");
    await writeProfile(
      dir,
      "explore",
      "---\ndescription: ok\nmodel: nonsense\n---\n",
    );
    await writeProfile(dir, "broken", "---\n: [\n---\n");
    await writeProfile(
      dir,
      "extra",
      profileFile("Has unknown key", "unknown: 1\n"),
    );

    const profiles = await service.list();
    const explore = profiles.find(
      (profile) => profile.name === "explore" && !profile.shadowed,
    );
    assert.equal(explore?.source, "user");
    assert.ok(explore?.error);
    assert.ok(profiles.find((profile) => profile.name === "broken")?.error);
    assert.ok(profiles.find((profile) => profile.name === "extra")?.error);
    const usable = (await service.usable(PROJECT_ID)).map(
      (profile) => profile.name,
    );
    assert.deepEqual(usable, ["developer"]);
  });

  it("applies enablement overrides and keeps a disabled definition authoritative", async () => {
    const { root, service, published } = await setup();
    await writeProfile(
      join(root, "home/agent/subagents"),
      "explore",
      profileFile("User explore"),
    );
    await service.setEnabled("explore", false);
    assert.deepEqual(
      JSON.parse(
        await readFile(join(root, "home/config/subagents.json"), "utf8"),
      ),
      { enabled: { explore: false } },
    );
    const usable = (await service.usable(PROJECT_ID)).map(
      (profile) => profile.name,
    );
    assert.deepEqual(usable, ["developer"]);
    assert.equal(await service.resolve(PROJECT_ID, "explore"), undefined);
    assert.equal((await service.find(PROJECT_ID, "explore"))?.source, "user");
    assert.deepEqual(published.at(-1), {
      type: "subagentProfiles.changed",
      data: {},
    });
    await service.setEnabled("explore", true);
    assert.equal(
      (await service.resolve(PROJECT_ID, "explore"))?.source,
      "user",
    );
  });

  it("gates project profiles on content trust bound to the digest", async () => {
    const { projectDir, service } = await setup();
    const dir = join(projectDir, ".nerve/subagents");
    await writeProfile(
      dir,
      "auditor",
      profileFile("Audits", "enabled: true\n"),
    );
    const before = await service.find(PROJECT_ID, "auditor");
    assert.equal(before?.trust, "untrusted");
    assert.equal(await service.resolve(PROJECT_ID, "auditor"), undefined);

    await assert.rejects(
      service.trust(PROJECT_ID, "auditor", "sha256:wrong"),
      /changed since/,
    );
    const trusted = await service.trust(PROJECT_ID, "auditor", before!.digest!);
    assert.equal(trusted.trust, "trusted");
    assert.ok(await service.resolve(PROJECT_ID, "auditor"));

    await writeProfile(dir, "auditor", profileFile("Audits differently"));
    assert.equal(await service.resolve(PROJECT_ID, "auditor"), undefined);
  });

  it("saves atomically, trusts project saves, renames and resets built-in edits", async () => {
    const { root, service, trusted, published } = await setup();

    const saved = await service.save({
      scope: "project",
      projectId: PROJECT_ID,
      profile: draft("auditor"),
    });
    assert.equal(saved.source, "project");
    assert.equal(saved.trust, "trusted");
    assert.equal(trusted.length, 1);
    assert.ok(await service.resolve(PROJECT_ID, "auditor"));
    assert.deepEqual(published.at(-1)?.data, { projectId: PROJECT_ID });

    const renamed = await service.save({
      scope: "project",
      projectId: PROJECT_ID,
      profile: draft("code-auditor"),
      previousName: "auditor",
    });
    assert.equal(renamed.name, "code-auditor");
    assert.equal(renamed.trust, "trusted");
    assert.equal(trusted.length, 1);
    assert.equal(await service.find(PROJECT_ID, "auditor"), undefined);
    await assert.rejects(
      service.save({
        scope: "project",
        projectId: PROJECT_ID,
        profile: draft("other-name"),
        previousName: "missing",
      }),
      /not found/,
    );
    await service.delete({
      scope: "project",
      projectId: PROJECT_ID,
      name: "code-auditor",
    });
    assert.equal(trusted.length, 0);
    assert.equal(await service.find(PROJECT_ID, "code-auditor"), undefined);

    // Editing a built-in writes a user file; deleting it resets the built-in.
    const edited = await service.save({
      scope: "user",
      profile: {
        ...draft("explore", "Edited explore"),
        permission: "read_only",
      },
    });
    assert.equal(edited.source, "user");
    assert.match(
      await readFile(join(root, "home/agent/subagents/explore.md"), "utf8"),
      /^---\n/,
    );
    assert.equal(
      (await service.find(PROJECT_ID, "explore"))?.description,
      "Edited explore",
    );
    await service.delete({ scope: "user", name: "explore" });
    const reset = await service.find(PROJECT_ID, "explore");
    assert.equal(reset?.source, "builtin");
    await assert.rejects(
      service.delete({ scope: "user", name: "explore" }),
      /not found/,
    );
  });

  it("round-trips instructions, tools and compaction through the file format", async () => {
    const { service } = await setup();
    const saved = await service.save({
      scope: "user",
      profile: {
        ...draft("custom"),
        label: "Custom",
        tools: { web_search: false },
        skills: { review: true },
        compaction: {
          profile: "custom",
          triggerPercent: 75,
          keepRecentPercent: 15,
        },
        model: "openai/gpt-5",
        thinking: "high",
      },
    });
    assert.equal(saved.error, undefined);
    assert.deepEqual(saved.tools, { web_search: false });
    assert.deepEqual(saved.skills, { review: true });
    assert.deepEqual(saved.compaction, {
      profile: "custom",
      triggerPercent: 75,
      keepRecentPercent: 15,
    });
    assert.equal(saved.instructions, "Work carefully.");
    assert.equal(saved.model, "openai/gpt-5");
  });
});

describe("subagentCompactionToSettings", () => {
  it("maps the shorthand and treats inherit as no override", () => {
    assert.equal(subagentCompactionToSettings("inherit"), undefined);
    assert.deepEqual(subagentCompactionToSettings({ profile: "balanced" }), {
      auto: true,
      profile: "balanced",
      customTriggerPercent: 80,
      customKeepRecentPercent: 15,
    });
    assert.deepEqual(
      subagentCompactionToSettings({
        auto: false,
        profile: "custom",
        triggerPercent: 70,
        keepRecentPercent: 10,
      }),
      {
        auto: false,
        profile: "custom",
        customTriggerPercent: 70,
        customKeepRecentPercent: 10,
      },
    );
  });
});
