import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyCapabilityOverrides,
  type CapabilityConfiguration,
  type CapabilityOverridesDocument,
} from "@nervekit/contracts/capabilities";
import {
  ComposerCapabilityController,
  type ComposerCapabilityState,
} from "./composer-capability-controller";

function configuration(
  digest: string,
  options: {
    disabledTools?: CapabilityConfiguration["effective"]["disabledTools"];
  } = {},
): CapabilityConfiguration {
  return {
    project: emptyCapabilityOverrides(),
    conversation: emptyCapabilityOverrides(),
    effective: {
      disabledTools: options.disabledTools ?? [],
      disabledFileSkills: [],
      enabledNerveSkills: [],
      enabledAgentBrowserSkills: [],
    },
    availableTools: ["web_search"],
    trust: { status: "missing" },
    projectDigest: "project",
    conversationDigest: digest,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const turn = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("ComposerCapabilityController", () => {
  it("serializes a refresh behind a write so stale reads cannot replace it", async () => {
    const write = deferred<CapabilityConfiguration>();
    let reads = 0;
    const states: ComposerCapabilityState[] = [];
    const controller = new ComposerCapabilityController({
      getConfiguration: async () => {
        reads += 1;
        return configuration(reads === 1 ? "d0" : "d1", {
          disabledTools: reads === 1 ? [] : ["web_search"],
        });
      },
      listSkills: async () => ({ skills: [] }),
      updateConfiguration: async () => write.promise,
      onStateChange: (state) => states.push(state),
    });

    controller.setScope({
      kind: "conversation",
      key: "conversation:a",
      projectId: "project",
      conversationId: "a",
    });
    await controller.refresh();
    assert.equal(reads, 1);

    const mutation = controller.patch({ tools: { web_search: false } });
    const refresh = controller.refresh();
    await turn();
    assert.equal(reads, 1);

    write.resolve(configuration("d1", { disabledTools: ["web_search"] }));
    await Promise.all([mutation, refresh]);
    assert.equal(reads, 2);
    assert.deepEqual(states.at(-1)?.configuration?.effective.disabledTools, [
      "web_search",
    ]);
  });

  it("uses each preceding write response as the digest for repeated toggles", async () => {
    const first = deferred<CapabilityConfiguration>();
    const digests: Array<string | undefined> = [];
    const controller = new ComposerCapabilityController({
      getConfiguration: async () => configuration("d0"),
      listSkills: async () => ({ skills: [] }),
      updateConfiguration: async (input) => {
        digests.push(input.expectedDigest);
        if (digests.length === 1) return first.promise;
        return configuration("d2");
      },
      onStateChange: () => undefined,
    });

    controller.setScope({
      kind: "conversation",
      key: "conversation:a",
      projectId: "project",
      conversationId: "a",
    });
    await controller.refresh();
    const disable = controller.patch({ tools: { web_search: false } });
    const enable = controller.patch({ tools: { web_search: true } });
    await turn();
    assert.deepEqual(digests, ["d0"]);

    first.resolve(configuration("d1", { disabledTools: ["web_search"] }));
    await Promise.all([disable, enable]);
    assert.deepEqual(digests, ["d0", "d1"]);
  });

  it("never publishes a load result from a scope that is no longer active", async () => {
    const oldLoad = deferred<CapabilityConfiguration>();
    const states: ComposerCapabilityState[] = [];
    const controller = new ComposerCapabilityController({
      getConfiguration: async (_projectId, conversationId) =>
        conversationId === "old" ? oldLoad.promise : configuration("new"),
      listSkills: async () => ({ skills: [] }),
      updateConfiguration: async () => configuration("unused"),
      onStateChange: (state) => states.push(state),
    });

    controller.setScope({
      kind: "conversation",
      key: "conversation:old",
      projectId: "project",
      conversationId: "old",
    });
    await turn();
    controller.setScope({
      kind: "conversation",
      key: "conversation:new",
      projectId: "project",
      conversationId: "new",
    });
    await controller.refresh();
    oldLoad.resolve(configuration("old"));
    await turn();

    assert.equal(states.at(-1)?.configuration?.conversationDigest, "new");
  });

  it("finishes a write for its captured scope without publishing into a new one", async () => {
    const oldWrite = deferred<CapabilityConfiguration>();
    const updatedConversations: string[] = [];
    const states: ComposerCapabilityState[] = [];
    const controller = new ComposerCapabilityController({
      getConfiguration: async (_projectId, conversationId) =>
        configuration(conversationId === "old" ? "old-0" : "new-0"),
      listSkills: async () => ({ skills: [] }),
      updateConfiguration: async (input) => {
        updatedConversations.push(input.conversationId);
        return oldWrite.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.setScope({
      kind: "conversation",
      key: "conversation:old",
      projectId: "project",
      conversationId: "old",
    });
    await controller.refresh();
    const mutation = controller.patch({ tools: { web_search: false } });
    await turn();
    controller.setScope({
      kind: "conversation",
      key: "conversation:new",
      projectId: "project",
      conversationId: "new",
    });
    await controller.refresh();
    oldWrite.resolve(configuration("old-1", { disabledTools: ["web_search"] }));
    await mutation;

    assert.deepEqual(updatedConversations, ["old"]);
    assert.equal(states.at(-1)?.configuration?.conversationDigest, "new-0");
  });

  it("reconciles canonical state after a failed write and remains usable", async () => {
    let reads = 0;
    let writes = 0;
    const states: ComposerCapabilityState[] = [];
    const controller = new ComposerCapabilityController({
      getConfiguration: async () => {
        reads += 1;
        return configuration(reads === 1 ? "d0" : "canonical", {
          disabledTools: reads === 1 ? [] : ["web_search"],
        });
      },
      listSkills: async () => ({ skills: [] }),
      updateConfiguration: async () => {
        writes += 1;
        if (writes === 1) throw new Error("digest conflict");
        return configuration("recovered");
      },
      onStateChange: (state) => states.push(state),
    });

    controller.setScope({
      kind: "conversation",
      key: "conversation:a",
      projectId: "project",
      conversationId: "a",
    });
    await controller.refresh();
    await controller.patch({ tools: { web_search: false } });

    assert.equal(states.at(-1)?.error, "digest conflict");
    assert.deepEqual(states.at(-1)?.configuration?.effective.disabledTools, [
      "web_search",
    ]);
    assert.equal(states.at(-1)?.mutating, false);

    await controller.patch({ tools: { web_search: true } });
    assert.equal(writes, 2);
    assert.equal(states.at(-1)?.error, undefined);
  });

  it("applies and resets pending overrides synchronously without reloading", async () => {
    let reads = 0;
    let saved: CapabilityOverridesDocument | undefined;
    const states: ComposerCapabilityState[] = [];
    const controller = new ComposerCapabilityController({
      getConfiguration: async () => {
        reads += 1;
        const base = configuration("missing");
        delete base.conversation;
        delete base.conversationDigest;
        return base;
      },
      listSkills: async () => ({ skills: [] }),
      updateConfiguration: async () => configuration("unused"),
      onStateChange: (state) => states.push(state),
    });

    controller.setScope({
      kind: "pending",
      key: "pending:new",
      projectId: "project",
      pendingId: "new",
      onOverridesChange: (overrides) => {
        saved = overrides;
      },
    });
    await controller.refresh();
    await controller.patch({ tools: { web_search: false } });

    assert.equal(reads, 1);
    assert.equal(saved?.tools.web_search, false);
    assert.deepEqual(states.at(-1)?.configuration?.effective.disabledTools, [
      "web_search",
    ]);

    await controller.reset();
    assert.equal(reads, 1);
    assert.deepEqual(saved, emptyCapabilityOverrides());
    assert.deepEqual(states.at(-1)?.configuration?.effective.disabledTools, []);
  });

  it("queues one trailing refresh when a change arrives during a read", async () => {
    const activeRead = deferred<CapabilityConfiguration>();
    let reads = 0;
    const controller = new ComposerCapabilityController({
      getConfiguration: async () => {
        reads += 1;
        if (reads === 1) return configuration("d0");
        if (reads === 2) return activeRead.promise;
        return configuration("d2");
      },
      listSkills: async () => ({ skills: [] }),
      updateConfiguration: async () => configuration("unused"),
      onStateChange: () => undefined,
    });

    controller.setScope({
      kind: "conversation",
      key: "conversation:a",
      projectId: "project",
      conversationId: "a",
    });
    await controller.refresh();
    const active = controller.refresh();
    await turn();
    const trailing = controller.refresh();
    const duplicateTrailing = controller.refresh();
    assert.equal(reads, 2);

    activeRead.resolve(configuration("d1"));
    await Promise.all([active, trailing, duplicateTrailing]);
    assert.equal(reads, 3);
  });

  it("coalesces duplicate queued refresh requests for one scope", async () => {
    const reload = deferred<CapabilityConfiguration>();
    let reads = 0;
    const controller = new ComposerCapabilityController({
      getConfiguration: async () => {
        reads += 1;
        return reads === 1 ? configuration("d0") : reload.promise;
      },
      listSkills: async () => ({ skills: [] }),
      updateConfiguration: async () => configuration("unused"),
      onStateChange: () => undefined,
    });

    controller.setScope({
      kind: "conversation",
      key: "conversation:a",
      projectId: "project",
      conversationId: "a",
    });
    await controller.refresh();
    const first = controller.refresh();
    const second = controller.refresh();
    await turn();
    assert.equal(reads, 2);

    reload.resolve(configuration("d1"));
    await Promise.all([first, second]);
    assert.equal(reads, 2);
  });
});
