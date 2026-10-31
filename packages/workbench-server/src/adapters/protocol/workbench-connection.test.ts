import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProtocolV1Message } from "@nervekit/contracts/wire";
import type { NotifyEvent } from "@nervekit/contracts/events";
import { WorkbenchConnection } from "./workbench-connection.js";

void test("PR events follow this connection's independent PR demand", () => {
  const connection = new WorkbenchConnection();
  const request = (method: string, repo = ".") =>
    connection.receive({
      kind: "request",
      data: { method, params: { projectId: "proj_test", repo } },
    } as ProtocolV1Message);
  const event = (repo = ".") =>
    ({
      type: "github.pr.changed",
      data: { projectId: "proj_test", repo },
    }) as NotifyEvent;
  assert.equal(connection.accepts(event()), false);
  request("git.repository.monitor.sync");
  assert.equal(connection.accepts(event()), false);
  request("github.pr.watch.sync");
  assert.equal(connection.accepts(event()), true);
  assert.equal(connection.accepts(event("other")), false);
  request("git.repository.monitor.clear");
  assert.equal(connection.accepts(event()), true);
  request("github.pr.watch.clear");
  assert.equal(connection.accepts(event()), false);
});
