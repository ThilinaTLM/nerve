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
  request("github.pr.watch.sync");
  assert.equal(connection.accepts(event()), true);
  assert.equal(connection.accepts(event("other")), false);
  request("github.pr.watch.clear");
  assert.equal(connection.accepts(event()), false);
});

void test("workspace changes follow this connection's Git workspace demand", () => {
  const connection = new WorkbenchConnection();
  const request = (method: string, params: Record<string, unknown>) =>
    connection.receive({
      kind: "request",
      data: { method, params: { projectId: "proj_test", ...params } },
    } as ProtocolV1Message);
  const event = (projectId = "proj_test") =>
    ({
      type: "git.workspace.changed",
      data: { projectId, revision: 1, repos: [], detail: [] },
    }) as NotifyEvent;
  assert.equal(connection.accepts(event()), false);
  request("git.workspace.watch.sync", { visible: true });
  assert.equal(connection.accepts(event()), true);
  assert.equal(connection.accepts(event("proj_other")), false);
  request("git.workspace.watch.sync", { visible: false });
  assert.equal(connection.accepts(event()), false);
  request("git.workspace.watch.sync", { visible: false, detail: ["api"] });
  assert.equal(connection.accepts(event()), true);
  request("git.workspace.watch.clear", {});
  assert.equal(connection.accepts(event()), false);
});
