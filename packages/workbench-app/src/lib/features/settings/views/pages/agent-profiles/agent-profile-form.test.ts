import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentProfile } from "@nervekit/contracts/agent-profiles";
import {
  blankForm,
  deriveProfileName,
  formFromProfile,
  formToDraft,
  formToPatch,
  formWithInheritedField,
  formFromConfiguration,
  localEntryAfterSave,
  parseProfileModel,
  validateForm,
} from "./agent-profile-form";

const profile: AgentProfile = {
  name: "reviewer",
  label: "Reviewer",
  description: "Reviews diffs.",
  enabled: true,
  source: "user",
  usableBy: "both",
  model: "openai/gpt-5.1-mini",
  thinking: { lock: "high" },
  permission: "read_only",
  compaction: {
    auto: false,
    profile: "custom",
    triggerPercent: 70,
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
    assert.equal(parseProfileModel("inherit"), undefined);
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
      usableBy: "both",
      model: "openai/gpt-5.1-mini",
      thinking: { lock: "high" },
      permission: "read_only",
      compaction: {
        auto: false,
        profile: "custom",
        triggerPercent: 70,
      },
      tools: { web_search: false, kroki_export: { url: "http://kroki.test/" } },
      skills: { lint: true },
      instructions: "Review carefully.",
    });
  });

  it("writes the shorthand: inherited values, no empty tools, no label when blank", () => {
    const form = { ...blankForm(), name: "scout", description: "Scouts." };
    assert.deepEqual(formToDraft(form), {
      name: "scout",
      description: "Scouts.",
      enabled: true,
      usableBy: "both",
      model: "inherit",
      thinking: "inherit",
      permission: "inherit",
      compaction: "inherit",
      skills: "inherit",
      instructions: "",
    });
  });

  it("omits thresholds unless the profile is custom and retains an explicit empty skill map", () => {
    const form = {
      ...blankForm(),
      compaction: {
        kind: "set" as const,
        value: {
          auto: true,
          profile: "aggressive" as const,
          triggerPercent: 80,
        },
      },
      skillsMode: "custom" as const,
    };
    const draft = formToDraft(form);
    assert.deepEqual(draft.compaction, { profile: "aggressive" });
    assert.deepEqual(draft.skills, {});
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

  it("keeps an unavailable model selected instead of falling back to the default", () => {
    const form = formFromProfile({ ...profile, model: "gone/model" });
    assert.deepEqual(form.model, {
      kind: "set",
      value: { provider: "gone", modelId: "model" },
    });
  });

  it("round-trips inherit, default and lock for every scalar", () => {
    const scalars = {
      model: { lock: "default" },
      thinking: "default",
      permission: { lock: "planning" },
      compaction: { lock: { profile: "balanced" } },
    } as const;
    const draft = formToDraft(formFromProfile({ ...profile, ...scalars }));
    assert.deepEqual(
      {
        model: draft.model,
        thinking: draft.thinking,
        permission: draft.permission,
        compaction: draft.compaction,
      },
      scalars,
    );
  });
});

describe("scoped sparse updates", () => {
  it("changes only edited fields and preserves existing equal pins", () => {
    const initial = formFromProfile(profile);
    assert.deepEqual(formToPatch(initial, initial), {});
    assert.deepEqual(
      formToPatch({ ...initial, description: "New description" }, initial),
      { description: "New description" },
    );
    assert.deepEqual(
      formToPatch(initial, initial, { pinned: ["model", "thinking"] }),
      { model: profile.model, thinking: { lock: "high" } },
    );
  });

  it("resets with null, independently of an explicit inherit", () => {
    const initial = formFromProfile(profile);
    assert.deepEqual(
      formToPatch(
        { ...initial, model: { kind: "inherit", value: "default" } },
        initial,
      ),
      { model: "inherit" },
    );
    assert.deepEqual(
      formToPatch(initial, initial, { reset: ["model", "thinking", "tools"] }),
      { model: null, thinking: null, tools: null },
    );
  });

  it("retains unknown references and removes only changed map keys", () => {
    const initial = formFromProfile({
      ...profile,
      tools: { portable_tool: true, web_search: false },
      skills: { portable_skill: true, lint: false },
    });
    const edited = structuredClone(initial);
    edited.tools.web_search = true;
    delete edited.skills.lint;
    assert.deepEqual(formToPatch(edited, initial), {
      tools: { web_search: true },
      skills: { lint: null },
    });
    assert.deepEqual(
      formToPatch(initial, initial, {
        tools: ["portable_tool"],
        skills: ["portable_skill"],
      }),
      { tools: { portable_tool: true }, skills: { portable_skill: true } },
    );
  });

  it("pins empty maps and sends explicit per-reference resets", () => {
    const initial = { ...blankForm(), name: "scout" };
    assert.deepEqual(formToPatch(initial, initial, { pinned: ["tools"] }), {
      tools: {},
    });
    assert.deepEqual(formToPatch(initial, initial, { tools: ["web_search"] }), {
      tools: { web_search: null },
    });
  });

  it("resets map controls to inheritance and removes all previous local choices before one new edit", () => {
    const initial = formFromProfile({
      ...profile,
      tools: { old_tool: true, web_search: false },
      skills: { old_skill: true, lint: false },
    });
    const inherited = {
      tools: { portable_tool: true, web_search: true },
      skills: { inherited_skill: true, lint: true },
    };
    let edited = formWithInheritedField(initial, "tools", inherited);
    edited = formWithInheritedField(edited, "skills", inherited);
    assert.deepEqual(edited.tools, inherited.tools);
    assert.deepEqual(edited.skills, inherited.skills);
    edited.tools.web_search = false;
    edited.skills.lint = false;
    assert.deepEqual(
      formToPatch(edited, initial, {
        resetMaps: ["tools", "skills"],
        local: { tools: initial.tools, skills: initial.skills },
        tools: ["web_search"],
        skills: ["lint"],
      }),
      {
        tools: { old_tool: null, web_search: false },
        skills: { old_skill: null, lint: false },
      },
    );
  });

  it("predicts the saved local entry: null deletes, maps merge and stay present", () => {
    assert.deepEqual(
      localEntryAfterSave(
        { model: "a/b", tools: { web_search: false, jira: true } },
        { model: null, thinking: "high", tools: { jira: null } },
      ),
      { thinking: "high", tools: { web_search: false } },
    );
    assert.deepEqual(localEntryAfterSave(null, { tools: { jira: null } }), {
      tools: {},
    });
  });

  it("allows resetting a required local value even when no lower profile supplies it", () => {
    const initial = formFromProfile(profile);
    const edited = formWithInheritedField(initial, "description", null);
    assert.equal(edited.description, "");
    assert.deepEqual(
      validateForm(edited, { resetFields: ["description"] }),
      {},
    );
    assert.deepEqual(formToPatch(edited, initial, { reset: ["description"] }), {
      description: null,
    });
  });

  it("reset then edit a skill map removes an old scalar mode without pinning inherited selections", () => {
    const initial = formFromProfile({ ...profile, skills: "none" });
    const edited = formWithInheritedField(initial, "skills", {
      skills: { inherited_skill: true },
    });
    edited.skills.new_skill = true;
    assert.deepEqual(
      formToPatch(edited, initial, {
        resetMaps: ["skills"],
        local: { skills: "none" },
        skills: ["new_skill"],
      }),
      { skills: { new_skill: true } },
    );
  });

  it("repairs a parsed incomplete entry without replacing custom instructions or capability references", () => {
    const local = {
      label: profile.label,
      enabled: profile.enabled,
      thinking: profile.thinking,
      permission: profile.permission,
      compaction: profile.compaction,
      instructions: profile.instructions,
      tools: profile.tools,
      skills: profile.skills,
    };
    const configuration = {
      name: profile.name,
      local,
      inherited: null,
      effective: null,
      origins: { fields: {}, tools: {}, skills: {} },
      trust: "trusted" as const,
      diagnostics: [],
    };
    const initial = formFromConfiguration(configuration);
    assert.ok(initial);
    assert.equal(initial.instructions, profile.instructions);
    assert.deepEqual(initial.tools, profile.tools);
    assert.deepEqual(initial.skills, profile.skills);
    const edited = { ...initial, description: "Restored description" };
    assert.deepEqual(formToPatch(edited, initial, { repair: configuration }), {
      description: "Restored description",
      usableBy: "both",
      model: "inherit",
    });
    assert.equal(
      formFromConfiguration({ ...configuration, local: null }),
      undefined,
      "invalid raw entries must not be edited",
    );
  });

  it("does not clamp thinking when selecting another model", () => {
    const initial = formFromProfile(profile);
    assert.deepEqual(
      formToPatch(
        {
          ...initial,
          model: {
            kind: "set",
            value: { provider: "other", modelId: "no-reasoning" },
          },
        },
        initial,
      ),
      { model: "other/no-reasoning" },
    );
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

  it("requires a name and a description", () => {
    const errors = validateForm(blankForm());
    assert.ok(errors.name);
    assert.ok(errors.description);
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
        compaction: {
          kind: "set",
          value: { auto: true, profile: "custom", triggerPercent: 95 },
        },
      }).compaction,
    );
  });
});
