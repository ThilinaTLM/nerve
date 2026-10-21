import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  conversationConfigSchema,
  type ConversationConfig,
} from "@nervekit/contracts/core";
import { defaultSettings } from "@nervekit/contracts/settings";
import { emptyCapabilityOverrides } from "@nervekit/contracts/capabilities";
import { toolDefinitionByName } from "@nervekit/tools/catalog";
import { CapabilityService } from "./capability.service.js";
import { createTurnResourcesPort } from "./turn-resources.adapter.js";
import { AgentProfileService } from "../domains/agent-profiles/agent-profile.service.js";
import { createProfileAvailability } from "./agent-profile-availability.js";

void test("fresh resources/settings and draft overrides use the same production preparation as saved turns", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-prompt-fresh-"));
  try {
    const projectDir = join(home, "project");
    const dataPath = join(home, "data");
    const conversationsPath = join(dataPath, "conversations");
    await mkdir(join(projectDir, ".nerve"), { recursive: true });
    await writeFile(join(projectDir, "AGENTS.md"), "Old context marker");
    await writeFile(
      join(projectDir, ".nerve", "APPEND_SYSTEM.md"),
      "Old append marker",
    );
    await mkdir(join(projectDir, ".nerve", "skills", "fresh-skill"), {
      recursive: true,
    });
    await writeFile(
      join(projectDir, ".nerve", "skills", "fresh-skill", "SKILL.md"),
      "---\nname: fresh-skill\ndescription: Fresh skill marker\n---\nInstructions",
    );
    const settings = structuredClone(defaultSettings);
    settings.tools.disabled = settings.tools.disabled.filter(
      (name) => !name.startsWith("subagent"),
    );
    const config: ConversationConfig = {
      conversationId: "c",
      model: { provider: "test", modelId: "draft" },
      reasoningLevel: "high",
      agentProfile: "coding",
      systemPrompt: null,
      instructions: "Old instructions marker",
      permissionRuleSetId: "baseline",
      workingDirectory: projectDir,
    };
    const core = {
      projects: { get: () => ({ id: "proj_test", directory: projectDir }) },
      getSnapshot: () => ({ conversation: { projectId: "proj_test" }, config }),
      trust: { list: () => [], isTrusted: () => false },
    };
    const capabilities = new CapabilityService(
      { paths: { dataPath }, settings } as never,
      core as never,
    );
    const capabilityOverrides = emptyCapabilityOverrides();
    capabilityOverrides.tools.subagents = { enabled: true };
    const leadChecks: unknown[] = [];
    const availability = createProfileAvailability({
      parent: () => config,
      modelInfo: async (selection) => {
        leadChecks.push(selection);
        return { supportedThinkingLevels: ["off", "high"] } as never;
      },
      resources: async (context) => {
        // Draft availability must see the selected capability document, too.
        if (!context.conversationId)
          assert.deepEqual(context.capabilityOverrides, capabilityOverrides);
        return { tools: new Map(), skills: new Map() };
      },
    });
    const profiles = new AgentProfileService({
      userPath: join(home, "profiles.json"),
      conversationsPath,
      trust: {
        isTrusted: () => false,
        decide: () => {
          throw new Error("No trust writes");
        },
      },
      events: {
        publish: () => {
          throw new Error("No preview events");
        },
      },
      getProject: () => ({ id: "proj_test", directory: projectDir }),
      getConversation: () => ({ projectId: "proj_test" }),
      availability,
    });
    const port = createTurnResourcesPort({
      home,
      tools: () => [toolDefinitionByName("read")!],
      skillCatalogs: {
        nerve: { skills: [] },
        agentBrowser: { skills: [] },
      },
      capabilities,
      agentProfiles: profiles,
      hasExistingSubagents: () => false,
    });
    const coreTools = [
      "subagent_prompt",
      "subagent_status",
      "subagent_stop",
      "plan_present",
    ].map((name) => toolDefinitionByName(name)!);
    const savedInput = {
      conversation: {
        id: "c",
        projectId: "proj_test",
        parentConversationId: null,
      },
      config,
      projectDir,
      coreTools,
    };
    const old = await port.prepare(savedInput);
    assert.match(old.systemPrompt, /Old context marker/);
    assert.match(old.systemPrompt, /Old append marker/);
    await writeFile(join(projectDir, "AGENTS.md"), "Fresh context marker 雪");
    await writeFile(
      join(projectDir, ".nerve", "APPEND_SYSTEM.md"),
      "Fresh append marker",
    );
    config.agentProfile = "planning";
    config.instructions = "Fresh instructions marker";
    const preview = await port.prepare(savedInput);
    assert.match(preview.systemPrompt, /Fresh context marker 雪/);
    assert.match(preview.systemPrompt, /Fresh append marker/);
    assert.match(preview.systemPrompt, /Fresh instructions marker/);
    assert.doesNotMatch(
      preview.systemPrompt,
      /Old (context|append|instructions) marker/,
    );
    assert.ok(preview.tools.some((tool) => tool.name === "plan_present"));
    assert.deepEqual(
      await port.prepare(savedInput),
      preview,
      "subsequent turn preparation is byte-identical",
    );
    assert.match(preview.systemPrompt, /Fresh skill marker/);
    settings.skills.disabled.push("fresh-skill");
    settings.tools.disabled.push("subagent_prompt");
    const changed = await port.prepare(savedInput);
    assert.ok(!changed.tools.some((tool) => tool.name.startsWith("subagent_")));
    assert.doesNotMatch(changed.systemPrompt, /Fresh skill marker/);
    assert.notEqual(changed.systemPrompt, preview.systemPrompt);
    settings.tools.disabled = settings.tools.disabled.filter(
      (name) => !name.startsWith("subagent"),
    );

    const document = {
      schemaVersion: 1 as const,
      profiles: { explore: { enabled: false } },
    };
    const draftConfig = conversationConfigSchema
      .omit({ conversationId: true })
      .parse(config);
    draftConfig.model = { provider: "test", modelId: "next-draft-model" };
    leadChecks.length = 0;
    settings.tools.disabled.push("subagent_prompt");
    const draft = await port.prepare({
      conversation: { projectId: "proj_test", parentConversationId: null },
      config: draftConfig,
      projectDir,
      coreTools,
      capabilityOverrides,
      agentProfileOverrides: document,
    });
    assert.ok(leadChecks.length > 0);
    assert.ok(
      leadChecks.every(
        (selection) =>
          JSON.stringify(selection) === JSON.stringify(draftConfig.model),
      ),
    );
    assert.ok(
      draft.tools.some((tool) => tool.name === "subagent_prompt"),
      "draft capability override enables subagents despite user setting",
    );
    assert.equal(
      await readFile(join(projectDir, "AGENTS.md"), "utf8"),
      "Fresh context marker 雪",
    );
    await assert.rejects(
      readdir(conversationsPath),
      { code: "ENOENT" },
      "draft preparation creates no conversation files",
    );
    // Simulate creation + saving exactly the same pending documents.
    const configDir = join(conversationsPath, "c", "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "capabilities.json"),
      JSON.stringify(capabilityOverrides),
    );
    await writeFile(
      join(configDir, "agent-profiles.json"),
      JSON.stringify(document),
    );
    Object.assign(config, draftConfig);
    const saved = await port.prepare(savedInput);
    assert.deepEqual(draft, saved);
    const profileParameters = JSON.stringify(
      draft.tools.find((tool) => tool.name === "subagent_prompt")?.parameters,
    );
    if (profileParameters)
      assert.doesNotMatch(
        profileParameters,
        /"explore"/,
        "disabled profiles are not offered",
      );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
