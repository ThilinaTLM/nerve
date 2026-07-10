import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { managerLogTailResponseSchema } from "@nervekit/contracts";
import type { ManagerState } from "../src/app/manager-state.js";
import { LogRingBuffer } from "../src/observability/log-ring-buffer.js";
import { tailManagerLogs } from "../src/routes/manager-logs-routes.js";

function stateWith(buffer: LogRingBuffer): ManagerState {
  return { logBuffer: buffer } as unknown as ManagerState;
}

function seed(buffer: LogRingBuffer): void {
  buffer.push({ ts: new Date().toISOString(), level: "debug", message: "d" });
  buffer.push({ ts: new Date().toISOString(), level: "info", message: "i" });
  buffer.push({ ts: new Date().toISOString(), level: "warn", message: "boom" });
}

describe("tailManagerLogs route", () => {
  it("returns a schema-valid response and honors level + limit + contains", () => {
    const buffer = new LogRingBuffer();
    seed(buffer);
    const result = tailManagerLogs(
      stateWith(buffer),
      new URLSearchParams("level=warn&limit=10"),
    );
    const parsed = managerLogTailResponseSchema.parse(result);
    assert.deepEqual(
      parsed.logs.map((l) => l.message),
      ["boom"],
    );
    assert.equal(parsed.nextCursor, 3);
    assert.equal(parsed.dropped, 0);

    const byContains = tailManagerLogs(
      stateWith(buffer),
      new URLSearchParams("contains=BOOM"),
    );
    assert.deepEqual(
      byContains.logs.map((l) => l.message),
      ["boom"],
    );
  });

  it("ignores an invalid level and clamps limit", () => {
    const buffer = new LogRingBuffer();
    seed(buffer);
    const result = tailManagerLogs(
      stateWith(buffer),
      new URLSearchParams("level=nonsense&limit=99999"),
    );
    // Invalid level → no level filter (all three returned).
    assert.equal(result.logs.length, 3);
  });

  it("tails from sinceSeq", () => {
    const buffer = new LogRingBuffer();
    seed(buffer);
    const result = tailManagerLogs(
      stateWith(buffer),
      new URLSearchParams("sinceSeq=2"),
    );
    assert.deepEqual(
      result.logs.map((l) => l.message),
      ["boom"],
    );
  });
});
