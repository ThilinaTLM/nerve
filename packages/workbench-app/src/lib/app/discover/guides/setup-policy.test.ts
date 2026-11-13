import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adjacentSetupStep, setupStepsForArea } from "./setup-policy.js";

describe("setup guide policy", () => {
  it("opens the project picker before highlighting Browse", () => {
    const steps = setupStepsForArea("open-project", {
      codexConnected: false,
    });
    assert.deepEqual(
      steps.map((step) => step.targetId),
      ["guide-project-open", "guide-project-browse"],
    );
    assert.equal(steps[0]?.advanceByClickingTarget, true);
  });

  it("ends the provider guide on standard API-key setup", () => {
    const steps = setupStepsForArea("provider", { codexConnected: false });
    assert.deepEqual(
      steps.map((step) => step.id),
      ["provider-subscription", "provider-api-key"],
    );
    assert.deepEqual(steps.at(-1)?.preparation, {
      kind: "settings",
      pageId: "providers",
      sectionId: "api-keys",
    });
  });

  it("guides disconnected voice users through connect and Codex selection", () => {
    assert.deepEqual(
      setupStepsForArea("voice", { codexConnected: false }).map(
        (step) => step.id,
      ),
      ["voice-connect", "voice-codex-choice"],
    );
  });

  it("targets the connected Codex row when voice is already configured", () => {
    const steps = setupStepsForArea("voice", { codexConnected: true });
    assert.deepEqual(
      steps.map((step) => step.id),
      ["voice-connected"],
    );
    assert.equal(steps[0]?.targetId, "setup-auth-openai-codex-connected");
  });

  it("guides web-search setup through the Web extension", () => {
    const steps = setupStepsForArea("web-search", {
      codexConnected: false,
    });
    assert.deepEqual(
      steps.map((step) => step.targetId),
      [
        "setup-tavily-add-profile",
        "setup-tavily-api-key",
        "setup-tavily-save",
        "setup-extension-web-enabled",
        "setup-extension-web-searchAccount",
      ],
    );
    assert.deepEqual(steps[0]?.preparation, {
      kind: "settings",
      pageId: "extensions",
      itemId: "web",
      sectionId: "accounts",
    });
    assert.equal(steps[0]?.advanceByClickingTarget, true);
  });

  it("guides Atlassian account setup through the Atlassian extension", () => {
    const steps = setupStepsForArea("atlassian", {
      codexConnected: false,
    });
    assert.deepEqual(
      steps.map((step) => step.targetId),
      [
        "setup-atlassian-add-profile",
        "setup-atlassian-profile-form",
        "setup-extension-atlassian-enabled",
        "setup-extension-atlassian-account",
        "setup-extension-atlassian-jira",
        "setup-extension-atlassian-confluence",
      ],
    );
    assert.deepEqual(steps[0]?.preparation, {
      kind: "settings",
      pageId: "extensions",
      itemId: "atlassian",
      sectionId: "accounts",
    });
    assert.deepEqual(steps[3]?.preparation, {
      kind: "settings",
      pageId: "extensions",
      itemId: "atlassian",
      sectionId: "settings",
    });
    assert.equal(steps[0]?.advanceByClickingTarget, true);
  });

  it("opens required dialogs when advancing to dialog-backed steps", () => {
    assert.equal(
      setupStepsForArea("voice", { codexConnected: false })[0]
        ?.advanceByClickingTarget,
      true,
    );
    assert.equal(
      setupStepsForArea("scoped-models", { codexConnected: false })[0]
        ?.advanceByClickingTarget,
      true,
    );
    assert.equal(
      setupStepsForArea("web-search", { codexConnected: false })[0]
        ?.advanceByClickingTarget,
      true,
    );
    assert.equal(
      setupStepsForArea("atlassian", { codexConnected: false })[0]
        ?.advanceByClickingTarget,
      true,
    );
  });

  it("ends each configuration guide at its most likely action", () => {
    assert.equal(
      setupStepsForArea("voice", { codexConnected: false }).at(-1)?.targetId,
      "setup-auth-openai-codex-choice",
    );
    assert.equal(
      setupStepsForArea("scoped-models", { codexConnected: false }).at(-1)
        ?.targetId,
      "setup-scoped-models-default",
    );
    // The main-model step retired with the standalone Default model picker;
    // choosing a model now lives in the scoped-models guide, and the default is
    // the starred entry in that same list.
    assert.equal(
      setupStepsForArea("agent-defaults", { codexConnected: false }).at(-1)
        ?.targetId,
      "setup-agent-profiles",
    );
  });

  it("clamps coach navigation to its sequence", () => {
    assert.equal(adjacentSetupStep(0, 3, -1), 0);
    assert.equal(adjacentSetupStep(1, 3, 1), 2);
    assert.equal(adjacentSetupStep(2, 3, 1), 2);
  });
});
