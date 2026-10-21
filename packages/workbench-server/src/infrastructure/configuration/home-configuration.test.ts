import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultUserConfiguration } from "@nervekit/contracts/settings";
import {
  configurationWithSettings,
  settingsFromConfiguration,
} from "./home-configuration.js";
import { resolveProjectSettings } from "./project-configuration.js";

void test("defaultAgentProfile round-trips through settings without manufacturing a saved default", () => {
  const configuration = structuredClone(defaultUserConfiguration);
  const settings = settingsFromConfiguration(configuration);
  assert.equal(settings.defaultAgentProfile, undefined);
  const updated = configurationWithSettings(configuration, {
    ...settings,
    defaultAgentProfile: "planning",
  });
  assert.equal(updated.harness.defaultAgentProfile, "planning");
  assert.equal(
    settingsFromConfiguration(updated).defaultAgentProfile,
    "planning",
  );
});

void test("project defaultAgentProfile overrides user settings", async () => {
  const project = await mkdtemp(join(tmpdir(), "nerve-profile-settings-"));
  try {
    const configuration = structuredClone(defaultUserConfiguration);
    configuration.harness.defaultAgentProfile = "coding";
    const storage = {
      configuration,
      settings: settingsFromConfiguration(configuration),
    };
    assert.equal(
      (
        await resolveProjectSettings(storage as never, project, {
          env: {},
          argv: [],
        })
      ).defaultAgentProfile,
      "coding",
    );
    await mkdir(join(project, ".nerve", "config"), { recursive: true });
    await writeFile(
      join(project, ".nerve", "config", "harness.json"),
      JSON.stringify({ defaultAgentProfile: "planning" }),
    );
    assert.equal(
      (
        await resolveProjectSettings(storage as never, project, {
          env: {},
          argv: [],
        })
      ).defaultAgentProfile,
      "planning",
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
