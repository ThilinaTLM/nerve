import { readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import type { TaskListeningPort, TaskRuntime } from "@nervekit/contracts";

const LISTEN_STATE = "0A";
const PROC_ROOT = "/proc";

interface ProcSocket {
  protocol: "tcp" | "tcp6";
  address: string;
  port: number;
  inode: string;
}

interface ProcIdentity {
  pid: number;
  processGroupId?: number;
  processStartTimeTicks?: number;
}

export async function inspectRuntimeListeningPorts(
  runtime: TaskRuntime,
  now = new Date(),
): Promise<TaskListeningPort[]> {
  if (runtime.platform !== "linux" || process.platform !== "linux") return [];
  if (!runtime.processGroupId && !runtime.childPid) return [];

  const ports = await inspectAllListeningPorts(now);
  return dedupeListeningPorts(
    ports.filter((port) => {
      if (runtime.processGroupId) {
        return port.processGroupId === runtime.processGroupId;
      }
      return port.pid === runtime.childPid;
    }),
  );
}

export async function inspectPortListeners(
  ports: TaskListeningPort[],
  now = new Date(),
): Promise<TaskListeningPort[]> {
  if (process.platform !== "linux" || ports.length === 0) return [];
  const expected = new Set(
    ports.map((port) => endpointKey(port.protocol, port.address, port.port)),
  );
  const current = await inspectAllListeningPorts(now);
  return dedupeListeningPorts(
    current.filter((port) =>
      expected.has(endpointKey(port.protocol, port.address, port.port)),
    ),
  );
}

export function isSameProcessIdentity(
  expected: TaskListeningPort,
  actual: TaskListeningPort,
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
  ports: TaskListeningPort[],
): TaskListeningPort[] {
  const seen = new Set<string>();
  const deduped: TaskListeningPort[] = [];
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

export function formatListeningPort(port: TaskListeningPort): string {
  const host = port.address.includes(":") ? `[${port.address}]` : port.address;
  return `${host}:${port.port}/${port.protocol}`;
}

async function inspectAllListeningPorts(
  now = new Date(),
): Promise<TaskListeningPort[]> {
  const sockets = await readListeningSockets();
  if (sockets.size === 0) return [];

  const detectedAt = now.toISOString();
  const ports: TaskListeningPort[] = [];
  for (const identity of await readProcSocketOwners(sockets)) {
    for (const socket of identity.sockets) {
      ports.push({
        protocol: socket.protocol,
        address: socket.address,
        port: socket.port,
        pid: identity.pid,
        processGroupId: identity.processGroupId,
        processStartTimeTicks: identity.processStartTimeTicks,
        detectedAt,
      });
    }
  }
  return dedupeListeningPorts(ports);
}

async function readListeningSockets(): Promise<Map<string, ProcSocket>> {
  const sockets = new Map<string, ProcSocket>();
  await Promise.all([
    readProcNetTcp("tcp").then((rows) => {
      for (const row of rows) sockets.set(row.inode, row);
    }),
    readProcNetTcp("tcp6").then((rows) => {
      for (const row of rows) sockets.set(row.inode, row);
    }),
  ]);
  return sockets;
}

async function readProcNetTcp(protocol: "tcp" | "tcp6"): Promise<ProcSocket[]> {
  let content: string;
  try {
    content = await readFile(join(PROC_ROOT, "net", protocol), "utf8");
  } catch {
    return [];
  }

  const rows: ProcSocket[] = [];
  for (const line of content.split("\n").slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 10) continue;
    const localAddress = columns[1];
    const state = columns[3];
    const inode = columns[9];
    if (!localAddress || state !== LISTEN_STATE || !inode || inode === "0") {
      continue;
    }
    const parsed = parseProcNetLocalAddress(protocol, localAddress);
    if (!parsed) continue;
    rows.push({ protocol, inode, ...parsed });
  }
  return rows;
}

async function readProcSocketOwners(
  sockets: Map<string, ProcSocket>,
): Promise<Array<ProcIdentity & { sockets: ProcSocket[] }>> {
  let entries: string[];
  try {
    entries = await readdir(PROC_ROOT);
  } catch {
    return [];
  }

  const owners: Array<ProcIdentity & { sockets: ProcSocket[] }> = [];
  await Promise.all(
    entries.map(async (entry) => {
      if (!/^\d+$/.test(entry)) return;
      const pid = Number(entry);
      const identity = await readProcIdentity(pid);
      if (!identity) return;
      const owned = await readProcessSockets(pid, sockets);
      if (owned.length === 0) return;
      owners.push({ ...identity, sockets: owned });
    }),
  );
  return owners;
}

async function readProcessSockets(
  pid: number,
  sockets: Map<string, ProcSocket>,
): Promise<ProcSocket[]> {
  const fdDir = join(PROC_ROOT, String(pid), "fd");
  let fds: string[];
  try {
    fds = await readdir(fdDir);
  } catch {
    return [];
  }

  const owned = new Map<string, ProcSocket>();
  await Promise.all(
    fds.map(async (fd) => {
      let target: string;
      try {
        target = await readlink(join(fdDir, fd));
      } catch {
        return;
      }
      const inode = socketInode(target);
      if (!inode) return;
      const socket = sockets.get(inode);
      if (socket) owned.set(inode, socket);
    }),
  );
  return [...owned.values()];
}

async function readProcIdentity(
  pid: number,
): Promise<ProcIdentity | undefined> {
  let stat: string;
  try {
    stat = await readFile(join(PROC_ROOT, String(pid), "stat"), "utf8");
  } catch {
    return undefined;
  }
  const closeParen = stat.lastIndexOf(")");
  if (closeParen < 0) return { pid };
  const fields = stat
    .slice(closeParen + 2)
    .trim()
    .split(/\s+/);
  const processGroupId = positiveNumber(fields[2]);
  const processStartTimeTicks = nonNegativeNumber(fields[19]);
  return { pid, processGroupId, processStartTimeTicks };
}

function parseProcNetLocalAddress(
  protocol: "tcp" | "tcp6",
  value: string,
): { address: string; port: number } | undefined {
  const [addressHex, portHex] = value.split(":");
  if (!addressHex || !portHex) return undefined;
  const port = Number.parseInt(portHex, 16);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
  const address =
    protocol === "tcp"
      ? parseIpv4ProcAddress(addressHex)
      : parseIpv6ProcAddress(addressHex);
  return address ? { address, port } : undefined;
}

function parseIpv4ProcAddress(hex: string): string | undefined {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) return undefined;
  const bytes = hex
    .match(/../g)
    ?.reverse()
    .map((byte) => Number.parseInt(byte, 16));
  if (!bytes || bytes.some((byte) => !Number.isInteger(byte))) return undefined;
  return bytes.join(".");
}

function parseIpv6ProcAddress(hex: string): string | undefined {
  if (!/^[0-9A-Fa-f]{32}$/.test(hex)) return undefined;
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 8) {
    const word = hex.slice(i, i + 8);
    const wordBytes = word.match(/../g)?.reverse() ?? [];
    for (const byte of wordBytes) bytes.push(Number.parseInt(byte, 16));
  }
  if (bytes.length !== 16 || bytes.some((byte) => !Number.isInteger(byte))) {
    return undefined;
  }
  const groups: string[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    groups.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16));
  }
  return compressIpv6(groups);
}

function compressIpv6(groups: string[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== "0") {
      i += 1;
      continue;
    }
    let end = i;
    while (end < groups.length && groups[end] === "0") end += 1;
    const length = end - i;
    if (length > bestLength && length > 1) {
      bestStart = i;
      bestLength = length;
    }
    i = end;
  }
  if (bestStart < 0) return groups.join(":");
  const before = groups.slice(0, bestStart).join(":");
  const after = groups.slice(bestStart + bestLength).join(":");
  if (!before && !after) return "::";
  if (!before) return `::${after}`;
  if (!after) return `${before}::`;
  return `${before}::${after}`;
}

function socketInode(target: string): string | undefined {
  const match = /^socket:\[(\d+)\]$/.exec(target);
  return match?.[1];
}

function positiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function endpointKey(
  protocol: TaskListeningPort["protocol"],
  address: string,
  port: number,
): string {
  return `${protocol}|${address}|${port}`;
}
