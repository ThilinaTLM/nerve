import type {
  LaunchListeningPort,
  LaunchPortConflictListener,
  LaunchRuntime,
} from "@nervekit/contracts/launches";
import {
  inspectTcpListeners,
  terminateTcpListener,
  type TcpListenerProcess,
  type TerminationResult,
} from "@nervekit/native";

export interface LaunchPortInspector {
  inspectRuntime(runtime: LaunchRuntime): Promise<LaunchListeningPort[]>;
  inspectListeners(
    ports: LaunchListeningPort[],
  ): Promise<LaunchListeningPort[]>;
  inspectPort(port: number): Promise<LaunchPortConflictListener[]>;
  terminateListener(
    listener: LaunchPortConflictListener,
    signal: "SIGTERM" | "SIGKILL",
  ): Promise<TerminationResult>;
}

export const defaultLaunchPortInspector: LaunchPortInspector = {
  inspectRuntime: inspectRuntimeListeningPorts,
  inspectListeners: inspectPortListeners,
  inspectPort: inspectConfiguredPort,
  terminateListener: terminateConfiguredPortListener,
};

export async function inspectRuntimeListeningPorts(
  runtime: LaunchRuntime,
  now = new Date(),
): Promise<LaunchListeningPort[]> {
  if (runtime.platform !== process.platform || !runtime.childPid) return [];
  return dedupeListeningPorts(
    inspectTcpListeners()
      .filter((listener) =>
        runtime.processGroupId
          ? listener.processGroupId === runtime.processGroupId
          : listener.pid === runtime.childPid,
      )
      .map((listener) => launchListeningPort(listener, now)),
  );
}

export async function inspectPortListeners(
  ports: LaunchListeningPort[],
  now = new Date(),
): Promise<LaunchListeningPort[]> {
  if (ports.length === 0) return [];
  const expected = new Set(
    ports.map((port) => endpointKey(port.protocol, port.address, port.port)),
  );
  const listeners = await inspectPorts([
    ...new Set(ports.map(({ port }) => port)),
  ]);
  return dedupeListeningPorts(
    listeners
      .filter((listener) =>
        expected.has(
          endpointKey(listener.protocol, listener.address, listener.port),
        ),
      )
      .map((listener) => launchListeningPort(listener, now)),
  );
}

export async function inspectConfiguredPort(
  port: number,
): Promise<LaunchPortConflictListener[]> {
  return inspectTcpListeners(port).map((listener) => ({
    protocol: listener.protocol,
    address: listener.address,
    port: listener.port,
    pid: listener.pid,
    identity: listener.identity,
    processName: listener.processName,
  }));
}

export async function terminateConfiguredPortListener(
  listener: LaunchPortConflictListener,
  signal: "SIGTERM" | "SIGKILL",
): Promise<TerminationResult> {
  return terminateTcpListener(listener, signal);
}

export function isSameProcessIdentity(
  expected: LaunchListeningPort,
  actual: LaunchListeningPort,
): boolean {
  if (!expected.pid || !actual.pid || expected.pid !== actual.pid) return false;
  if (
    expected.processStartTimeTicks !== undefined &&
    actual.processStartTimeTicks !== undefined &&
    expected.processStartTimeTicks !== actual.processStartTimeTicks
  ) {
    return false;
  }
  if (
    expected.processGroupId !== undefined &&
    actual.processGroupId !== undefined &&
    expected.processGroupId !== actual.processGroupId
  ) {
    return false;
  }
  return true;
}

export function dedupeListeningPorts(
  ports: LaunchListeningPort[],
): LaunchListeningPort[] {
  const seen = new Set<string>();
  const deduped: LaunchListeningPort[] = [];
  for (const port of ports) {
    const key = [
      port.protocol,
      port.address,
      port.port,
      port.pid ?? "",
      port.processStartTimeTicks ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(port);
  }
  return deduped.sort(
    (a, b) =>
      a.port - b.port ||
      a.protocol.localeCompare(b.protocol) ||
      a.address.localeCompare(b.address) ||
      (a.pid ?? 0) - (b.pid ?? 0),
  );
}

export function formatListeningPort(port: LaunchListeningPort): string {
  const host = port.address.includes(":") ? `[${port.address}]` : port.address;
  return `${host}:${port.port}/${port.protocol}`;
}

async function inspectPorts(ports: number[]): Promise<TcpListenerProcess[]> {
  const listeners = await Promise.all(
    ports.map(async (port) => inspectTcpListeners(port)),
  );
  return listeners.flat();
}

function launchListeningPort(
  listener: TcpListenerProcess,
  now: Date,
): LaunchListeningPort {
  const processStartTimeTicks = listener.identity.startsWith("linux:")
    ? Number(listener.identity.slice("linux:".length))
    : undefined;
  return {
    protocol: listener.protocol,
    address: listener.address,
    port: listener.port,
    pid: listener.pid,
    processGroupId: listener.processGroupId,
    processStartTimeTicks:
      Number.isSafeInteger(processStartTimeTicks) &&
      (processStartTimeTicks ?? -1) >= 0
        ? processStartTimeTicks
        : undefined,
    detectedAt: now.toISOString(),
  };
}

function endpointKey(
  protocol: LaunchListeningPort["protocol"],
  address: string,
  port: number,
): string {
  return `${protocol}|${address}|${port}`;
}
