import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AgentProfilesConfiguration,
  AgentProfilePatch,
  AgentProfilesDocument,
} from "@nervekit/contracts/agent-profiles";
import {
  ConversationProfileController,
  conversationProfileScope,
  type ConversationProfileState,
  type PendingConversationProfileScope,
} from "./conversation-profile-controller";

function configuration(digest: string | null): AgentProfilesConfiguration {
  return {
    scope: "conversation",
    document: { schemaVersion: 1, profiles: {} },
    digest,
    trust: "trusted",
    diagnostics: [],
    profiles: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const scope = {
  kind: "saved" as const,
  projectId: "proj_one",
  conversationId: "conv_one",
};

test("interactive saved leads acquire a profile scope; children stay barred", () => {
  assert.deepEqual(
    conversationProfileScope(scope.projectId, {
      id: scope.conversationId,
      parentConversationId: null,
    }),
    scope,
  );
  assert.equal(conversationProfileScope(scope.projectId, undefined), undefined);
  assert.equal(
    conversationProfileScope(scope.projectId, {
      id: "child",
      parentConversationId: scope.conversationId,
    }),
    undefined,
  );
  assert.equal(
    conversationProfileScope(scope.projectId, { id: "unknown-parent" }),
    undefined,
  );
  assert.equal(
    conversationProfileScope(undefined, {
      id: scope.conversationId,
      parentConversationId: null,
    }),
    undefined,
  );
  assert.equal(
    conversationProfileScope(
      scope.projectId,
      { id: scope.conversationId, parentConversationId: null },
      false,
    ),
    undefined,
  );
});

test("demand loading and stale reads cannot replace a new conversation", async () => {
  const first = deferred<AgentProfilesConfiguration>();
  let state: ConversationProfileState = { loading: false, saving: false };
  let reads = 0;
  const controller = new ConversationProfileController({
    preview: async () => configuration("unused"),
    read: async () => (++reads === 1 ? first.promise : configuration("new")),
    update: async () => configuration("unused"),
    changed: (next) => {
      state = next;
    },
  });
  assert.equal(reads, 0);
  controller.follow(scope);
  await Promise.resolve();
  controller.follow({ ...scope, conversationId: "conv_two" });
  first.resolve(configuration("old"));
  await controller.refresh();
  assert.equal(state.configuration?.digest, "new");
  controller.follow(undefined);
  assert.equal(state.configuration, undefined);
});

test("mutations serialize and carry the latest digest, preserving sparse explicit/reset patches", async () => {
  const calls: { patch: AgentProfilePatch; digest: string | null }[] = [];
  const first = deferred<AgentProfilesConfiguration>();
  const controller = new ConversationProfileController({
    preview: async () => configuration("unused"),
    read: async () => configuration(null),
    update: async (_scope, _name, patch, digest) => {
      calls.push({ patch, digest });
      return calls.length === 1 ? first.promise : configuration("second");
    },
    changed: () => {},
  });
  controller.follow(scope);
  await controller.refresh();
  const one = controller.mutate("developer", { model: "inherit" });
  const two = controller.mutate("developer", { thinking: null });
  await Promise.resolve();
  assert.equal(calls.length, 1);
  first.resolve(configuration("first"));
  await Promise.all([one, two]);
  assert.deepEqual(calls, [
    { patch: { model: "inherit" }, digest: null },
    { patch: { thinking: null }, digest: "first" },
  ]);
});

test("conflicts refresh without replaying the edit or subsequent queued edits", async () => {
  let reads = 0;
  let writes = 0;
  let state: ConversationProfileState = { loading: false, saving: false };
  const controller = new ConversationProfileController({
    preview: async () => configuration("unused"),
    read: async () => configuration(`read-${++reads}`),
    update: async () => {
      writes++;
      throw new Error("digest conflict");
    },
    changed: (next) => {
      state = next;
    },
  });
  controller.follow(scope);
  await controller.refresh();
  await Promise.all([
    controller.mutate("developer", { enabled: false }),
    controller.mutate("developer", { thinking: "high" }),
  ]);
  assert.equal(writes, 1);
  assert.equal(state.configuration?.digest, "read-3");
  assert.match(state.error ?? "", /not saved/);
  assert.equal(state.saving, false);
  await controller.refresh();
  assert.match(
    state.error ?? "",
    /not saved/,
    "event refresh retains the conflict notice",
  );
});

test("closing while a write is in flight discards its result", async () => {
  const write = deferred<AgentProfilesConfiguration>();
  let state: ConversationProfileState = { loading: false, saving: false };
  const controller = new ConversationProfileController({
    preview: async () => configuration("unused"),
    read: async () => configuration("initial"),
    update: () => write.promise,
    changed: (next) => {
      state = next;
    },
  });
  controller.follow(scope);
  await controller.refresh();
  const pending = controller.mutate("developer", { enabled: true });
  await Promise.resolve();
  controller.follow(undefined);
  write.resolve(configuration("late"));
  await pending;
  assert.equal(state.configuration, undefined);
  assert.equal(state.saving, false);
});

test("portable references survive quick edits and malformed documents cannot be overwritten", async () => {
  const portable = configuration("portable");
  portable.document!.profiles.developer = {
    tools: { future_tool: true },
    skills: { future_skill: true },
    thinking: "xhigh",
  };
  portable.diagnostics = [
    {
      severity: "warning",
      code: "unavailable",
      reference: "future_tool",
      message: "Unavailable capability",
    },
  ];
  let current = portable;
  let state: ConversationProfileState = { loading: false, saving: false };
  const patches: AgentProfilePatch[] = [];
  const controller = new ConversationProfileController({
    preview: async () => configuration("unused"),
    read: async () => current,
    update: async (_scope, _name, patch) => {
      patches.push(patch);
      return current;
    },
    changed: (next) => {
      state = next;
    },
  });
  controller.follow(scope);
  await controller.refresh();
  await controller.mutate("developer", { model: "other/model" });
  assert.deepEqual(patches, [{ model: "other/model" }]);
  assert.deepEqual(state.configuration?.document?.profiles.developer, {
    tools: { future_tool: true },
    skills: { future_skill: true },
    thinking: "xhigh",
  });
  current = {
    ...portable,
    diagnostics: [
      {
        severity: "blocking",
        code: "invalid_document",
        message: "Malformed JSON",
      },
    ],
  };
  await controller.refresh();
  await controller.mutate("developer", { enabled: true });
  assert.equal(patches.length, 1);
});

test("closing clears scope and reopening demands a fresh configuration", async () => {
  let reads = 0;
  let state: ConversationProfileState = { loading: false, saving: false };
  const controller = new ConversationProfileController({
    preview: async () => configuration("unused"),
    read: async () => configuration(`fresh-${++reads}`),
    update: async () => {
      throw new Error("unexpected mutation");
    },
    changed: (next) => {
      state = next;
    },
  });
  controller.follow(scope);
  await controller.refresh();
  const previousReads = reads;
  controller.follow(undefined);
  await controller.refresh();
  assert.equal(reads, previousReads);
  assert.equal(state.configuration, undefined);
  controller.follow(scope);
  await controller.refresh();
  assert.ok(reads > previousReads);
  assert.equal(
    (state as ConversationProfileState).configuration?.digest,
    `fresh-${reads}`,
  );
});

function pendingScope(
  onDocumentChange: PendingConversationProfileScope["onDocumentChange"],
  document?: AgentProfilesDocument,
): PendingConversationProfileScope {
  return {
    kind: "pending",
    projectId: scope.projectId,
    pendingId: "draft-one",
    lead: {
      model: { provider: "openai", modelId: "gpt-5" },
      reasoningLevel: "high",
    },
    document,
    onDocumentChange,
  };
}

function pendingHarness(
  preview?: (input: {
    document: AgentProfilesDocument;
    lead: PendingConversationProfileScope["lead"];
  }) => Promise<AgentProfilesConfiguration>,
) {
  let state: ConversationProfileState = { loading: false, saving: false };
  const calls: AgentProfilesDocument[] = [];
  const controller = new ConversationProfileController({
    read: async () => {
      throw new Error("draft must not read a saved profile");
    },
    update: async () => {
      throw new Error("draft must not write a saved profile");
    },
    preview: async (input) => {
      calls.push(input.document);
      if (preview) return preview(input);
      return { ...configuration(null), document: input.document };
    },
    changed: (next) => {
      state = next;
    },
  });
  return { controller, calls, state: () => state };
}

test("pending roots get stable scopes, while saved children and noninteractive drafts remain barred", () => {
  const pending = pendingScope(() => {});
  assert.deepEqual(
    conversationProfileScope(scope.projectId, undefined, true, pending),
    pending,
  );
  assert.equal(
    conversationProfileScope(scope.projectId, undefined, false, pending),
    undefined,
  );
  assert.equal(
    conversationProfileScope(
      scope.projectId,
      { id: "child", parentConversationId: "parent" },
      true,
      pending,
    ),
    undefined,
  );
});

test("pending patches synchronously persist sparse overrides, reset inherited fields, and survive remount", async () => {
  let document: AgentProfilesDocument | undefined;
  const owner = (next: AgentProfilesDocument) => {
    document = next;
  };
  const { controller, state } = pendingHarness();
  controller.follow(pendingScope(owner));
  await controller.refresh();
  const edit = controller.mutate("developer", {
    model: "inherit",
    thinking: "high",
  });
  assert.deepEqual(document?.profiles.developer, {
    model: "inherit",
    thinking: "high",
  });
  await edit;
  await controller.mutate("developer", { model: null });
  assert.deepEqual(document?.profiles.developer, { thinking: "high" });
  assert.deepEqual(state().configuration?.document, document);
  const remount = pendingHarness();
  remount.controller.follow(pendingScope(owner, document));
  await remount.controller.refresh();
  assert.deepEqual(remount.state().configuration?.document, document);
  await remount.controller.mutate("developer", { thinking: null });
  assert.deepEqual(document?.profiles.developer, {});
});

test("pending previews coalesce rapid edits and ignore in-flight stale revisions and scopes", async () => {
  const slow = deferred<AgentProfilesConfiguration>();
  let slowNext = false;
  let document: AgentProfilesDocument | undefined;
  const harness = pendingHarness(async ({ document }) =>
    slowNext
      ? ((slowNext = false), slow.promise)
      : { ...configuration("current"), document },
  );
  const pending = pendingScope((next) => {
    document = next;
  });
  harness.controller.follow(pending);
  await harness.controller.refresh();
  slowNext = true;
  const first = harness.controller.mutate("developer", { enabled: false });
  await Promise.resolve();
  const second = harness.controller.mutate("developer", { thinking: "high" });
  const third = harness.controller.mutate("developer", { model: "inherit" });
  assert.deepEqual(document?.profiles.developer, {
    enabled: false,
    thinking: "high",
    model: "inherit",
  });
  slow.resolve(configuration("stale"));
  await Promise.all([first, second, third]);
  assert.deepEqual(harness.state().configuration?.document, document);
  // Only the first in-flight and latest queued revisions were previewed.
  assert.equal(harness.calls.length, 4);
  harness.controller.follow({
    ...pendingScope(() => {}),
    pendingId: "draft-two",
  });
  await harness.controller.refresh();
  assert.deepEqual(harness.state().configuration?.document?.profiles, {});
  harness.controller.follow(pendingScope(() => {}, document));
  await harness.controller.refresh();
  assert.deepEqual(harness.state().configuration?.document, document);
});

test("preview failures retain draft edits; refresh and lead changes use current overrides", async () => {
  let fail = false;
  let document: AgentProfilesDocument | undefined;
  let lead: PendingConversationProfileScope["lead"] | undefined;
  const harness = pendingHarness(async (input) => {
    lead = input.lead;
    if (fail) throw new Error("preview unavailable");
    return { ...configuration(null), document: input.document };
  });
  const owner = (next: AgentProfilesDocument) => {
    document = next;
  };
  harness.controller.follow(pendingScope(owner));
  await harness.controller.refresh();
  fail = true;
  await harness.controller.mutate("developer", { enabled: false });
  assert.equal(document?.profiles.developer?.enabled, false);
  assert.match(harness.state().error ?? "", /preview unavailable/);
  fail = false;
  const next = {
    ...pendingScope(owner, document),
    lead: {
      model: { provider: "anthropic", modelId: "claude" },
      reasoningLevel: "off" as const,
    },
  };
  harness.controller.follow(next);
  await harness.controller.refresh();
  assert.deepEqual(lead, next.lead);
  assert.deepEqual(harness.state().configuration?.document, document);
  assert.equal(harness.state().error, undefined);
  await harness.controller.refresh();
  assert.deepEqual(harness.calls.at(-1), document);
});

test("sending drafts and blocking documents cannot be edited", async () => {
  let changes = 0;
  const pending = pendingScope(() => {
    changes++;
  });
  const harness = pendingHarness();
  harness.controller.follow(pending);
  await harness.controller.refresh();
  harness.controller.follow({ ...pending, readonly: () => true });
  await harness.controller.mutate("developer", { enabled: false });
  assert.equal(changes, 0);
  harness.controller.follow(pending);
  await harness.controller.mutate("developer", { enabled: false });
  assert.equal(changes, 1);
  const blocked = pendingHarness(async () => ({
    ...configuration(null),
    diagnostics: [
      {
        severity: "blocking",
        code: "invalid",
        message: "Invalid project document",
      },
    ],
  }));
  blocked.controller.follow(pending);
  await blocked.controller.refresh();
  await blocked.controller.mutate("developer", { enabled: false });
  assert.equal(changes, 1);
});

test("an old draft's in-flight preview cannot populate a new draft or a closed editor", async () => {
  const slow = deferred<AgentProfilesConfiguration>();
  let reads = 0;
  const seen: (string | null | undefined)[] = [];
  let state: ConversationProfileState = { loading: false, saving: false };
  const controller = new ConversationProfileController({
    read: async () => configuration("unused"),
    update: async () => configuration("unused"),
    preview: async () =>
      ++reads === 1 ? slow.promise : configuration("second"),
    changed: (next) => {
      state = next;
      seen.push(next.configuration?.digest);
    },
  });
  controller.follow(pendingScope(() => {}));
  await Promise.resolve();
  controller.follow({ ...pendingScope(() => {}), pendingId: "draft-two" });
  slow.resolve(configuration("old-draft"));
  await controller.refresh();
  assert.equal(state.configuration?.digest, "second");
  assert.equal(seen.includes("old-draft"), false);
  controller.follow(undefined);
  assert.equal(state.configuration, undefined);
});

test("lead context changes invalidate in-flight preview results without discarding local overrides", async () => {
  const slow = deferred<AgentProfilesConfiguration>();
  let slowNext = false;
  const harness = pendingHarness(async ({ document }) => {
    if (slowNext) {
      slowNext = false;
      return slow.promise;
    }
    return { ...configuration("new-lead"), document };
  });
  const document: AgentProfilesDocument = {
    schemaVersion: 1,
    profiles: { developer: { thinking: "inherit" } },
  };
  const pending = pendingScope(() => {}, document);
  harness.controller.follow(pending);
  await harness.controller.refresh();
  slowNext = true;
  const old = harness.controller.refresh();
  await Promise.resolve();
  harness.controller.follow({
    ...pending,
    lead: { ...pending.lead, reasoningLevel: "off" },
  });
  slow.resolve(configuration("old-lead"));
  await old;
  assert.notEqual(harness.state().configuration?.digest, "old-lead");
  await harness.controller.refresh();
  assert.deepEqual(harness.state().configuration?.document, document);
});

test("stable draft identity retains configuration and notices in-place lead/document changes", async () => {
  const harness = pendingHarness();
  const pending = pendingScope(() => {}, {
    schemaVersion: 1,
    profiles: { developer: { enabled: false } },
  });
  harness.controller.follow(pending);
  await harness.controller.refresh();
  const configuration = harness.state().configuration;
  const count = harness.calls.length;
  harness.controller.follow({ ...pending, readonly: () => true });
  assert.equal(harness.state().configuration, configuration);
  assert.equal(harness.calls.length, count);
  pending.lead.model.modelId = "another-model";
  harness.controller.follow(pending);
  await Promise.resolve();
  assert.equal(harness.calls.length, count + 1);
  await harness.controller.refresh();
  const afterLead = harness.calls.length;
  pending.document!.profiles.developer!.enabled = true;
  harness.controller.follow(pending);
  await Promise.resolve();
  assert.equal(harness.calls.length, afterLead + 1);
  await harness.controller.refresh();
  assert.equal(
    harness.state().configuration?.document?.profiles.developer?.enabled,
    true,
  );
});

test("the sending lock is synchronous, without waiting for a same-scope follow", async () => {
  let sending = false;
  let changes = 0;
  const harness = pendingHarness();
  harness.controller.follow({
    ...pendingScope(() => {
      changes++;
    }),
    readonly: () => sending,
  });
  await harness.controller.refresh();
  sending = true;
  await harness.controller.mutate("developer", { enabled: false });
  assert.equal(changes, 0);
  sending = false;
  await harness.controller.mutate("developer", { enabled: false });
  assert.equal(changes, 1);
});
