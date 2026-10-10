import assert from "node:assert/strict";
import { it } from "node:test";
import { ServerHeartbeat } from "../../src/sessions/server-heartbeat.js";

for (const failure of ["send", "timeout"] as const) {
  for (const asynchronous of [false, true]) {
    it(`stops heartbeat timers after a ${asynchronous ? "rejected" : "thrown"} ${failure} failure`, async () => {
      let now = 0;
      const intervals = new Map<symbol, () => void>();
      const errors: unknown[] = [];
      const error = new Error("WebSocket is not open");
      const fail = () => {
        if (asynchronous) return Promise.reject(error);
        throw error;
      };
      const heartbeat = new ServerHeartbeat({
        clock: { now: () => now, isoNow: () => new Date(now).toISOString() },
        timers: {
          setTimeout: () => Symbol(),
          clearTimeout: () => {},
          setInterval: (callback) => {
            const id = Symbol();
            intervals.set(id, callback);
            return id;
          },
          clearInterval: (id) => {
            intervals.delete(id as symbol);
          },
        },
        intervalMs: 10,
        timeoutMs: 20,
        isReady: () => true,
        send: failure === "send" ? fail : () => {},
        timeout: failure === "timeout" ? fail : () => {},
        onError: (error) => {
          errors.push(error);
        },
      });
      heartbeat.start();
      assert.equal(intervals.size, 2);
      if (failure === "timeout") now = 21;
      for (const tick of intervals.values()) tick();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(errors, [error]);
      assert.equal(intervals.size, 0);
    });
  }
}
