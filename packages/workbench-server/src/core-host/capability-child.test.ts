import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultSettings } from "@nervekit/contracts/settings";
import type { Skill } from "@nervekit/harness/resources";
import { atomicWriteJson } from "../infrastructure/storage-bootstrap/index.js";
import { CapabilityService } from "./capability.service.js";

const skill = (name: string) =>
  ({ name, description: name, filePath: `/skills/${name}/SKILL.md` }) as Skill;

async function setup(
  enabled: { nerve?: string[]; agentBrowser?: string[] } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "nerve-child-"));
  const project = join(dir, "project");
  await mkdir(project);
  const service = new CapabilityService(
    {
      paths: { dataPath: dir, home: dir },
      settings: {
        ...defaultSettings,
        skills: {
          ...defaultSettings.skills,
          nerve: { enabled: enabled.nerve ?? [] },
          agentBrowser: { enabled: enabled.agentBrowser ?? [] },
        },
      },
    } as never,
    {
      getSnapshot: () => ({ conversation: { projectId: "p" } }),
      projects: { get: () => ({ id: "p", directory: project }) },
      trust: { list: () => [], isTrusted: () => false },
    } as never,
  );
  const file = (id: string) =>
    join(dir, "conversations", id, "config", "capabilities.json");
  const read = async (id: string) =>
    JSON.parse(await readFile(file(id), "utf8"));
  return {
    dir,
    service,
    file,
    read,
    cleanup: () => rm(dir, { recursive: true }),
  };
}

void test("the profile delta is applied over the parent's conversation file", async () => {
  const { service, file, read, cleanup } = await setup();
  await atomicWriteJson(file("parent"), {
    schemaVersion: 2,
    tools: { web_search: { enabled: false } },
    toolSettings: {},
    skills: { file: {}, nerve: { alpha: true }, agentBrowser: {} },
  });
  await service.initializeChild(
    "parent",
    "child",
    {
      tools: { web_fetch: false, python_exec: false },
      skills: { alpha: false },
    },
    [skill("alpha"), skill("beta")],
    [],
  );
  const child = await read("child");
  assert.deepEqual(child.tools.web_search, { enabled: false });
  assert.equal(child.tools.web_fetch.enabled, false);
  assert.equal(child.tools.python_exec.enabled, false);
  assert.equal(child.skills.nerve.alpha, undefined);
  await cleanup();
});

void test("skills none disables every available skill; inherit writes nothing for a bare parent", async () => {
  const { service, file, read, cleanup } = await setup({
    nerve: ["alpha"],
    agentBrowser: ["browser"],
  });
  await service.initializeChild(
    "parent",
    "none",
    { tools: {}, skills: "none" },
    [skill("alpha")],
    [skill("browser")],
  );
  const document = await read("none");
  assert.equal(document.skills.nerve.alpha, false);
  assert.equal(document.skills.agentBrowser.browser, false);
  await service.initializeChild(
    "parent",
    "plain",
    { tools: {}, skills: "inherit" },
    [skill("alpha")],
    [],
  );
  await assert.rejects(stat(file("plain")), { code: "ENOENT" });
  await cleanup();
});

void test("portable unknown tools and skills are retained in the profile, not child capabilities", async () => {
  const { service, read, cleanup } = await setup();
  try {
    const profile = {
      tools: { future_tool: true, future_disabled: false, web_fetch: false },
      skills: { future_skill: true },
    };
    await service.initializeChild("parent", "child", profile, [], []);
    const child = await read("child");
    assert.equal(child.tools.future_tool, undefined);
    assert.equal(child.tools.future_disabled, undefined);
    assert.equal(child.skills.file.future_skill, undefined);
    assert.equal(child.tools.web_fetch.enabled, false);
    assert.equal(profile.tools.future_tool, true);
    assert.equal(profile.skills.future_skill, true);
  } finally {
    await cleanup();
  }
});
