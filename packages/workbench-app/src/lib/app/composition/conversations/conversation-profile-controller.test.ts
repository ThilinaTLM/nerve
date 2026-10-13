import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  SubagentProfilesConfiguration,
  SubagentProfilePatch,
} from "@nervekit/contracts/subagents";
import {
  ConversationProfileController,
  conversationProfileScope,
  type ConversationProfileState,
} from "./conversation-profile-controller";

function configuration(digest: string | null): SubagentProfilesConfiguration {
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
const scope = { projectId: "proj_one", conversationId: "conv_one" };

test("only interactive saved leads can acquire a profile scope", () => {
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
  const first = deferred<SubagentProfilesConfiguration>();
  let state: ConversationProfileState = { loading: false, saving: false };
  let reads = 0;
  const controller = new ConversationProfileController({
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
  const calls: { patch: SubagentProfilePatch; digest: string | null }[] = [];
  const first = deferred<SubagentProfilesConfiguration>();
  const controller = new ConversationProfileController({
    read: async () => configuration(null),
    update: async (_scope, _name, patch, digest) => {
      calls.push({ patch, digest });
      return calls.length === 1 ? first.promise : configuration("second");
    },
    changed: () => {},
  });
  controller.follow(scope);
  await controller.refresh();
  const one = controller.mutate("developer", { model: "lead" });
  const two = controller.mutate("developer", { thinking: null });
  await Promise.resolve();
  assert.equal(calls.length, 1);
  first.resolve(configuration("first"));
  await Promise.all([one, two]);
  assert.deepEqual(calls, [
    { patch: { model: "lead" }, digest: null },
    { patch: { thinking: null }, digest: "first" },
  ]);
});

test("conflicts refresh without replaying the edit or subsequent queued edits", async () => {
  let reads = 0;
  let writes = 0;
  let state: ConversationProfileState = { loading: false, saving: false };
  const controller = new ConversationProfileController({
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
  const write = deferred<SubagentProfilesConfiguration>();
  let state: ConversationProfileState = { loading: false, saving: false };
  const controller = new ConversationProfileController({
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
  const patches: SubagentProfilePatch[] = [];
  const controller = new ConversationProfileController({
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
