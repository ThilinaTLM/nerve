import assert from "node:assert/strict";
import test from "node:test";
import { scopedConversationCreation } from "./scoped-conversation-creation.js";
import {
  fixture,
  definition,
  A,
  user,
  project,
  put,
} from "../infrastructure/configuration/agent-configuration/agent-configuration-test-fixture.js";

for (const scenario of [
  { name: "authored off stays off", authored: false, expected: false },
  { name: "absent authored default enables omitted profiles", expected: true },
  {
    name: "explicit user on overrides authored off",
    authored: false,
    user: true,
    expected: true,
  },
  {
    name: "conversation on overrides user and project off",
    authored: false,
    user: false,
    project: false,
    conversation: true,
    expected: true,
  },
  {
    name: "required off locks conversation on",
    conversation: true,
    required: false,
    expected: false,
  },
  {
    name: "recommended off permits conversation on",
    conversation: true,
    recommended: false,
    expected: true,
  },
]) {
  void test(scenario.name, async (t) => {
    const f = await fixture(t, {
      builtins: {
        coding: JSON.stringify({ ...definition, enabled: scenario.authored }),
      },
    });
    await f.agent(user, {
      schemaVersion: 1,
      revision: 0,
      overrides: {
        model: A,
        ...(scenario.user !== undefined
          ? { subagents: { coding: { enabled: scenario.user } } }
          : {}),
      },
    });
    if (scenario.project !== undefined)
      await f.agent(project, {
        schemaVersion: 1,
        revision: 0,
        overrides: { subagents: { coding: { enabled: scenario.project } } },
      });
    await f.service.createConversation("parent", {
      schemaVersion: 1,
      revision: 1,
      appliedProfile: {
        name: "lead",
        source: "builtin",
        sourceDigest: "a".repeat(64),
        instructions: "",
        recommendations:
          scenario.recommended !== undefined
            ? { subagents: { coding: { enabled: scenario.recommended } } }
            : {},
        requirements:
          scenario.required !== undefined
            ? { subagents: { coding: { enabled: scenario.required } } }
            : {},
      },
      overrides: {
        tools: { subagents: { enabled: true } },
        ...(scenario.conversation !== undefined
          ? { subagents: { coding: { enabled: scenario.conversation } } }
          : {}),
      },
    });
    const defaults = await f.service.captureDefaults("p");
    assert.equal(
      defaults.options.subagentDefaults?.coding,
      scenario.authored ?? true,
    );
    const view = await f.service.getEffective("parent");
    assert.equal(view.status, "available");
    if (view.status !== "available") return;
    assert.equal(
      view.resolution.settings.subagents?.coding?.enabled,
      scenario.expected,
    );
    const creation = scopedConversationCreation(f.service, async () => {});
    const launch = () =>
      creation.childHost.resolveProfile({
        parentId: "parent",
        profile: "coding",
      });
    if (!scenario.expected) {
      await assert.rejects(launch, /disabled/);
      return;
    }
    const preflight = await launch();
    await creation.initializeConversation({
      id: "child",
      projectId: "p",
      parentConversationId: "parent",
      application: preflight.application,
    });
    assert.equal((await f.service.getEffective("child")).status, "available");
  });
}

void test("untrusted and malformed definitions shadow defaults; explicit enablement cannot launch them or missing profiles", async (t) => {
  const f = await fixture(t);
  await put(f.service.paths.profile(project, "coding"), definition);
  await put(f.service.paths.profile(user, "broken"), "{");
  await f.service.createConversation("parent", {
    schemaVersion: 1,
    revision: 1,
    appliedProfile: null,
    overrides: {
      tools: { subagents: { enabled: true } },
      subagents: {
        coding: { enabled: true },
        broken: { enabled: true },
        missing: { enabled: true },
      },
    },
  });
  const defaults = await f.service.captureDefaults("p");
  assert.deepEqual(defaults.options.subagentDefaults, {});
  const creation = scopedConversationCreation(f.service, async () => {});
  for (const profile of ["coding", "broken", "missing"])
    await assert.rejects(
      creation.childHost.resolveProfile({ parentId: "parent", profile }),
      /unavailable/,
    );
});
