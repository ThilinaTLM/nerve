import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultProcessRuntimeDriver } from "../src/index.js";

if (process.platform === "linux") {
  test("captures a verifiable Linux identity and refuses stale identity", async () => {
    const spawned = await defaultProcessRuntimeDriver.spawn("sleep 30", {
      cwd: process.cwd(),
    });
    try {
      assert.equal(
        (await defaultProcessRuntimeDriver.inspect(spawned.runtime)).evidence,
        "alive_verified",
      );
      const stale = {
        ...spawned.runtime,
        identity: {
          kind: "linux" as const,
          startTimeTicks:
            spawned.runtime.identity?.kind === "linux"
              ? spawned.runtime.identity.startTimeTicks + 1
              : 1,
        },
      };
      assert.equal(
        (await defaultProcessRuntimeDriver.inspect(stale)).evidence,
        "identity_mismatch",
      );
      const refused = await defaultProcessRuntimeDriver.terminate(
        stale,
        "SIGKILL",
      );
      assert.equal(refused.attempted, false);
    } finally {
      await defaultProcessRuntimeDriver.terminate(spawned.runtime, "SIGKILL");
    }
  });
}
