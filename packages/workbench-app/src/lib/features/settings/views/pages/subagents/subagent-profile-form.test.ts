import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SubagentProfile } from "@nervekit/contracts/subagents";
import {
  blankForm,
  deriveProfileName,
  formFromProfile,
  formToDraft,
  parseProfileModel,
  validateForm,
} from "./subagent-profile-form";

const profile: SubagentProfile = {
  name: "reviewer",
  label: "Reviewer",
  description: "Reviews diffs.",
  enabled: true,
  source: "user",
  model: "openai/gpt-5.1-mini",
  thinking: "high",
  permission: "read_only",
  compaction: {
    auto: false,
    profile: "custom",
    triggerPercent: 70,
    keepRecentPercent: 10,
  },
  tools: { web_search: false, kroki_export: { url: "http://kroki.test/" } },
  skills: { lint: true },
  instructions: "Review carefully.",
};

describe("profile name", () => {
  it("derives a valid name from a label", () => {
    assert.equal(deriveProfileName("Code Reviewer!"), "code-reviewer");
    assert.equal(deriveProfileName("  --Ünï cödé--  "), "uni-code");
    assert.equal(deriveProfileName("x".repeat(60)).length, 32);
    assert.equal(deriveProfileName("???"), "");
  });

  it("splits model ids at the first slash", () => {
    assert.deepEqual(parseProfileModel("openrouter/anthropic/claude"), {
      provider: "openrouter",
      modelId: "anthropic/claude",
    });
    assert.equal(parseProfileModel("lead"), undefined);
  });
});

describe("profile form conversion", () => {
  it("round-trips a profile through the form", () => {
    const draft = formToDraft(formFromProfile(profile));
    assert.deepEqual(draft, {
      name: "reviewer",
      label: "Reviewer",
      description: "Reviews diffs.",
      enabled: true,
      model: "openai/gpt-5.1-mini",
      thinking: "high",
      permission: "read_only",
      compaction: {
        auto: false,
        profile: "custom",
        triggerPercent: 70,
        keepRecentPercent: 10,
      },
      tools: { web_search: false, kroki_export: { url: "http://kroki.test/" } },
      skills: { lint: true },
      instructions: "Review carefully.",
    });
  });

  it("writes the shorthand: lead values, no empty tools, no label when blank", () => {
    const form = { ...blankForm(), name: "scout", description: "Scouts." };
    assert.deepEqual(formToDraft(form), {
      name: "scout",
      description: "Scouts.",
      enabled: true,
      model: "lead",
      thinking: "lead",
      permission: "autonomous",
      compaction: "inherit",
      skills: "inherit",
      instructions: "",
    });
  });

  it("omits thresholds unless the profile is custom and treats empty custom skills as inherit", () => {
    const form = {
      ...blankForm(),
      compactionMode: "profile" as const,
      compactionProfile: "aggressive" as const,
      skillsMode: "custom" as const,
    };
    const draft = formToDraft(form);
    assert.deepEqual(draft.compaction, { profile: "aggressive" });
    assert.equal(draft.skills, "inherit");
  });

  it("duplicates under a free name with a copy label", () => {
    const form = formFromProfile(profile, {
      duplicate: true,
      takenNames: ["reviewer-copy"],
    });
    assert.equal(form.nameLocked, false);
    assert.equal(form.name, "reviewer-copy-2");
    assert.equal(form.label, "Reviewer copy");
  });

  it("keeps an unavailable model selected instead of falling back to lead", () => {
    const form = formFromProfile({ ...profile, model: "gone/model" });
    assert.equal(form.modelLead, false);
    assert.deepEqual(form.model, { provider: "gone", modelId: "model" });
  });
});

describe("profile form validation", () => {
  const valid = {
    ...blankForm(),
    name: "scout",
    description: "Scouts the code.",
  };

  it("accepts a complete form", () => {
    assert.deepEqual(validateForm(valid), {});
  });

  it("requires a name, a description and a chosen model", () => {
    const errors = validateForm({
      ...blankForm(),
      modelLead: false,
    });
    assert.ok(errors.name);
    assert.ok(errors.description);
    assert.ok(errors.model);
  });

  it("rejects invalid names and names already used in the scope", () => {
    assert.ok(validateForm({ ...valid, name: "Not Valid" }).name);
    assert.ok(
      validateForm(valid, { takenNames: ["scout"] }).name,
      "taken for a new profile",
    );
    assert.equal(
      validateForm({ ...valid, nameLocked: true }, { takenNames: ["scout"] })
        .name,
      undefined,
      "an existing profile keeps its name",
    );
  });

  it("limits description length, instruction size and custom thresholds", () => {
    assert.ok(
      validateForm({ ...valid, description: "x".repeat(201) }).description,
    );
    assert.ok(
      validateForm({ ...valid, instructions: "é".repeat(9 * 1024) })
        .instructions,
    );
    assert.ok(
      validateForm({
        ...valid,
        compactionMode: "profile",
        compactionProfile: "custom",
        triggerPercent: 95,
      }).compaction,
    );
  });
});
