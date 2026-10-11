import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultLaunchSupervisor } from "../../../src/domains/launches/application/launch-supervisor.js";

const node = JSON.stringify(process.execPath);

test("captures immediate native exit and close outcomes", async () => {
  const spawned = defaultLaunchSupervisor.spawn(
    `${node} -e ${JSON.stringify("process.stdout.write('done')")}`,
    { cwd: process.cwd() },
  );
  assert.equal((await spawned.exited).kind, "closed");
  assert.equal((await spawned.closed).kind, "closed");
  assert.equal((await spawned.runtime).platform, process.platform);
});

if (process.platform === "linux") {
  test("refuses stale serialized Linux identity", async () => {
    const spawned = defaultLaunchSupervisor.spawn("sleep 30", {
      cwd: process.cwd(),
    });
    const runtime = await spawned.runtime;
    try {
      assert.equal(
        await defaultLaunchSupervisor.isRuntimeTargetAlive(runtime),
        true,
      );
      assert.equal(runtime.identity?.kind, "linux");
      if (runtime.identity?.kind !== "linux") assert.fail("Missing identity");
      const stale = {
        ...runtime,
        identity: {
          kind: "linux" as const,
          startTimeTicks: runtime.identity.startTimeTicks + 1,
        },
      };
      assert.equal(
        await defaultLaunchSupervisor.isRuntimeTargetAlive(stale),
        false,
      );
      const refused = await defaultLaunchSupervisor.terminateRuntime(
        stale,
        "SIGKILL",
      );
      assert.equal(refused.attempted, false);
      assert.match(refused.error ?? "", /PID was reused/);
    } finally {
      await defaultLaunchSupervisor.terminate(spawned.child, "SIGKILL");
      await spawned.closed;
    }
  });
}
