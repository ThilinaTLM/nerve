import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";
import { prepareShellProcess } from "../../../src/infrastructure/process-host/shell-process.js";
import type { DomainEventIntent } from "../../../src/core/ports/domain-events.js";
import type { LaunchServicePorts } from "../../../src/domains/launches/application/launch.service.js";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import {
  createService,
  servicePortsForRecords,
} from "./launch-service-fixture.js";

test("restart and output retain the run's project identity with an external cwd", async () => {
  const records = new Map<string, LaunchRecord>();
  const ports = servicePortsForRecords(records, []);
  let nextId = 0;
  ports.ids = { next: () => `launch_${++nextId}` };
  const queried: LaunchRecord[] = [];
  ports.logs.query = async (launch) => {
    queried.push(launch);
    return { events: [], nextCursor: 0 };
  };
  const service = createService(ports);
  const original = await service.start({
    definitionId: "launchdef_copied",
    projectId: "proj_copy",
    command: "original command",
    cwd: "/external",
  });
  records.set(original.id, { ...original, status: "completed" });
  const restarted = await service.restart(original.id);
  assert.equal(restarted.projectId, "proj_copy");
  assert.equal(restarted.definitionId, "launchdef_copied");
  assert.equal(restarted.cwd, "/external");
  assert.equal(restarted.command, "original command");
  await service.logs(restarted.id, {});
  assert.equal(queried[0]?.projectId, "proj_copy");
  assert.equal(queried[0]?.id, restarted.id);
});

test("prepared standalone restart snapshots stored env once and never persists the admitted environment", async () => {
  const records = new Map<string, LaunchRecord>();
  const events: DomainEventIntent[] = [];
  let loadCalls = 0;
  const env = { PREPARED_RESTART_PROBE: "original" };
  let spawned:
    | Parameters<LaunchServicePorts["process"]["spawn"]>[0]
    | undefined;
  const savedEnvs: (Record<string, string> | undefined)[] = [];
  const ports: LaunchServicePorts = {
    ...servicePortsForRecords(records, events, {
      spawn: async (input) => {
        spawned = input;
        return { pid: 42, startedAt: new Date().toISOString() };
      },
    }),
    env: {
      persisted: true,
      save: async (_id, value) => {
        savedEnvs.push(value);
      },
      load: async () => {
        loadCalls++;
        return env;
      },
      remove: async () => {},
    },
  };
  const service = createService(ports);
  const old = await service.start({
    command: "original command",
    cwd: tmpdir(),
    env,
  });
  records.get(old.id)!.status = "completed";
  const request = await service.prepareRestart(old.id);
  const preparedShell = prepareShellProcess(request.command, {
    cwd: request.cwd,
    env: request.env,
    shellPath: process.execPath,
    projectEnvironment: false,
  });
  env.PREPARED_RESTART_PROBE = "changed";
  records.get(old.id)!.command = "different command";
  await service.restartPrepared(old.id, { ...request, preparedShell });
  assert.equal(loadCalls, 1);
  assert.equal(spawned?.command, "original command");
  assert.equal(spawned?.env?.PREPARED_RESTART_PROBE, "original");
  assert.equal(
    spawned?.preparedShell?.invocation.env?.PREPARED_RESTART_PROBE,
    "original",
  );
  assert.equal("preparedShell" in records.get("launch_contract")!, false);
  assert.deepEqual(Object.keys(savedEnvs[1] ?? {}), ["PREPARED_RESTART_PROBE"]);
  await assert.rejects(
    service.restartPrepared(old.id, {
      ...request,
      command: "substitution",
      preparedShell,
    }),
    /does not match/,
  );
  ports.env!.load = async () => undefined;
  await assert.rejects(
    service.prepareRestart(old.id),
    /environment is unavailable/,
  );
});
