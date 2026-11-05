import assert from "node:assert/strict";
import { test } from "node:test";
import type { SubscriptionUsage } from "@nervekit/contracts/usage";
import { SubscriptionUsageService } from "./subscription-usage-service.js";

void test("stop waits for in-flight refreshes and rejects later ones", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let fetches = 0;
  let finished = 0;
  const service = new SubscriptionUsageService({
    auth: {
      credentialType: async () => "oauth",
      getApiKey: async () => "token",
    } as never,
    events: { publish: async () => {} } as never,
    cacheDir: "/unused",
    fetchAnthropicUsage: async () => {
      fetches += 1;
      await gate;
      finished += 1;
      return null as SubscriptionUsage | null;
    },
    fetchCodexUsage: async () => null,
  });

  const refresh = service.getSnapshots({ refresh: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1);

  const stopped = service.stop();
  release();
  await stopped;
  assert.equal(finished, 1, "stop resolved before the in-flight fetch ended");
  await refresh;

  await service.getSnapshots({ refresh: true });
  assert.equal(fetches, 1);
});
