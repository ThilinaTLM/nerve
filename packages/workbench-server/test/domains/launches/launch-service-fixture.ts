import type { DomainEventIntent } from "../../../src/core/ports/domain-events.js";
import {
  LaunchService,
  type LaunchServicePorts,
} from "../../../src/domains/launches/application/launch.service.js";
import type { LaunchRecord } from "@nervekit/contracts/launches";

export function createService(ports: LaunchServicePorts): LaunchService {
  const launches = new Map<string, LaunchRecord>();
  const save = ports.repository.save;
  const remove = ports.repository.remove;
  ports.repository.save = async (launch) => {
    await save(launch);
    launches.set(launch.id, launch);
  };
  ports.repository.remove = async (id) => {
    await remove(id);
    launches.delete(id);
  };
  return new LaunchService({
    ports,
    launches,
    managed: new Map(),
    repository: {} as never,
    logs: {} as never,
    supervisor: { inspectRuntimeListeningPorts: async () => [] } as never,
  });
}

export function servicePortsForRecords(
  records: Map<string, LaunchRecord>,
  events: DomainEventIntent[],
  options: {
    save?: (launch: LaunchRecord) => Promise<void>;
    spawn?: LaunchServicePorts["process"]["spawn"];
    inspect?: LaunchServicePorts["process"]["inspect"];
    signal?: LaunchServicePorts["process"]["signal"];
    readiness?: LaunchServicePorts["readiness"];
    diagnostics?: LaunchServicePorts["diagnostics"];
    timers?: LaunchServicePorts["timers"];
    clock?: LaunchServicePorts["clock"];
    definitionPortGuard?: LaunchServicePorts["definitionPortGuard"];
  } = {},
): LaunchServicePorts {
  return {
    repository: {
      get: async (id) => records.get(id),
      list: async () => [...records.values()],
      save:
        options.save ??
        (async (launch) =>
          void records.set(launch.id, structuredClone(launch))),
      remove: async (id) => void records.delete(id),
    },
    process: {
      spawn:
        options.spawn ??
        (async () => ({
          pid: 42,
          startedAt: "2026-07-11T00:00:00.000Z",
        })),
      signal: options.signal ?? (async () => undefined),
      inspect: options.inspect ?? (async () => "running"),
      waitForExit: async () => "timeout",
    },
    logs: {
      query: async () => ({ events: [], nextCursor: 0 }),
      append: async () => undefined,
      remove: async () => undefined,
    },
    readiness: options.readiness,
    events: { publish: async (event) => void events.push(event) },
    clock:
      options.clock ??
      ({ now: () => new Date("2026-07-11T00:00:00.000Z") } as const),
    ids: { next: () => "launch_contract" },
    diagnostics: options.diagnostics,
    timers: options.timers,
    definitionPortGuard: options.definitionPortGuard,
  };
}
