import assert from "node:assert/strict";
import { removeTree } from "@nervekit/test-kit";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import type { PushSubscriptionData } from "@nervekit/contracts/access";
import {
  PushService,
  STOP_SUPPRESSION_MS,
  type PushConversationSource,
  type PushDevices,
  type PushSendOptions,
} from "../../../src/domains/access/push-service.js";

const roots: string[] = [];
after(() => Promise.all(roots.map((r) => removeTree(r))));

const sub = (name: string): PushSubscriptionData => ({
  endpoint: `https://push.example/${name}`,
  keys: { p256dh: "p", auth: "a" },
});

function summary(
  patch: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id: "root",
    projectId: "proj",
    title: "Fix login",
    parentConversationId: null,
    status: "running",
    pendingWork: false,
    pendingInput: null,
    ...patch,
  } as ConversationSummary;
}

async function fixture(initial: ConversationSummary[] = [summary()]) {
  const dir = await mkdtemp(join(tmpdir(), "nerve-push-"));
  roots.push(dir);
  const subscriptions = new Map<string, PushSubscriptionData>([
    ["dev_a", sub("a")],
  ]);
  const devices: PushDevices = {
    setPushSubscription: async (id, s) => (subscriptions.set(id, s), true),
    clearPushSubscription: async (id) => void subscriptions.delete(id),
    pushSubscription: async (id) => subscriptions.get(id),
    subscribedDevices: async () =>
      [...subscriptions].map(([deviceId, subscription]) => ({
        deviceId,
        subscription,
      })),
  };
  const sent: Array<{
    endpoint: string;
    payload: Record<string, unknown>;
    options: PushSendOptions;
  }> = [];
  const failures = new Map<string, number>();
  const warnings: string[] = [];
  const clock = { now: 1_000 };
  const push = new PushService({
    devices,
    vapidKeysPath: join(dir, "secrets", "vapid-keys.json"),
    now: () => clock.now,
    logger: { warn: (m) => void warnings.push(m) },
    send: async (subscription, payload, options) => {
      const status = failures.get(subscription.endpoint);
      if (status)
        throw Object.assign(new Error("push failed"), { statusCode: status });
      sent.push({
        endpoint: subscription.endpoint,
        payload: JSON.parse(payload) as Record<string, unknown>,
        options,
      });
    },
  });
  let listener: Parameters<PushConversationSource["subscribe"]>[0] = () => {};
  push.start({
    subscribe: (l) => ((listener = l), () => {}),
    listSummaries: () => initial,
    projectName: () => "Atlas",
  });
  const change = async (next: ConversationSummary) => {
    listener({ kind: "conversation_changed", summary: next });
    await push.settled();
  };
  return { push, sent, subscriptions, failures, warnings, clock, change, dir };
}

describe("PushService", () => {
  it("pushes a finished edge without transcript content, with TTL and urgency", async () => {
    const f = await fixture();
    await f.change(summary({ status: "idle" }));
    assert.equal(f.sent.length, 1);
    assert.deepEqual(f.sent[0]!.payload, {
      type: "attention",
      conversationId: "root",
      openConversationId: "root",
      reason: "finished",
      conversationTitle: "Fix login",
      projectName: "Atlas",
    });
    assert.equal(f.sent[0]!.options.ttl, 86_400);
    assert.equal(f.sent[0]!.options.urgency, "normal");
    assert.equal(
      (await stat(join(f.dir, "secrets", "vapid-keys.json"))).mode & 0o777,
      0o600,
    );
  });

  it("opens the asking sub-agent for input edges with high urgency", async () => {
    const f = await fixture();
    await f.change(
      summary({
        status: "waiting",
        pendingInput: {
          conversationId: "child",
          conversationTitle: "Researcher",
          toolCallId: "t1",
          kind: "approval",
        },
      }),
    );
    const { payload, options } = f.sent[0]!;
    assert.equal(payload.reason, "input");
    assert.equal(payload.inputKind, "approval");
    assert.equal(payload.openConversationId, "child");
    assert.equal(payload.subAgentTitle, "Researcher");
    assert.equal(options.urgency, "high");
  });

  it("stays quiet for the baseline and new conversations", async () => {
    const f = await fixture([summary({ status: "failed" })]);
    await f.change(summary({ status: "failed" }));
    await f.change(summary({ id: "other", status: "failed" }));
    assert.equal(f.sent.length, 0);
  });

  it("is suppressed while any client is active or muted, until its report ends", async () => {
    const f = await fixture();
    f.push.reportPresence("s1", { active: false, muted: false });
    f.push.reportPresence("s2", { active: true, muted: false });
    await f.change(summary({ status: "failed" }));
    assert.equal(f.sent.length, 0);

    f.push.releaseOwner("s2");
    f.push.reportPresence("s3", { active: false, muted: true });
    await f.change(summary({ status: "running" }));
    await f.change(summary({ status: "failed" }));
    assert.equal(f.sent.length, 0);

    f.push.releaseOwner("s3");
    await f.change(summary({ status: "running" }));
    await f.change(summary({ status: "failed" }));
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0]!.options.urgency, "high");
  });

  it("silences the edge after a user Stop within 30 s only", async () => {
    const f = await fixture();
    f.push.noteUserStop("root");
    await f.change(summary({ status: "interrupted" }));
    assert.equal(f.sent.length, 0);

    await f.change(summary({ status: "running" }));
    f.push.noteUserStop("root");
    f.clock.now += STOP_SUPPRESSION_MS + 1;
    await f.change(summary({ status: "interrupted" }));
    assert.equal(f.sent.length, 1);
  });

  it("drops dead subscriptions on 404/410 and only warns otherwise", async () => {
    const f = await fixture();
    f.subscriptions.set("dev_b", sub("b"));
    f.subscriptions.set("dev_c", sub("c"));
    f.failures.set("https://push.example/a", 410);
    f.failures.set("https://push.example/b", 500);
    await f.change(summary({ status: "idle" }));
    assert.deepEqual([...f.subscriptions.keys()], ["dev_b", "dev_c"]);
    assert.deepEqual(
      f.sent.map((s) => s.endpoint),
      ["https://push.example/c"],
    );
    assert.deepEqual(f.warnings, ["Push delivery failed (HTTP 500)"]);
  });

  it("sends a test push and reports a missing subscription", async () => {
    const f = await fixture();
    await f.push.sendTest("dev_a");
    assert.deepEqual(f.sent[0]!.payload, { type: "test" });
    await assert.rejects(f.push.sendTest("dev_none"), { status: 409 });
    assert.equal((await f.push.state("dev_a")).subscribed, true);
    assert.equal((await f.push.state("dev_none")).subscribed, false);
  });
});
