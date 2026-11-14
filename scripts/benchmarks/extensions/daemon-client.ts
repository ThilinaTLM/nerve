/**
 * Client for a local dev-slot daemon's conversation channel (`/ws/conversations`).
 *
 * Conversation, project, model and permission operations are served only over
 * that WebSocket (the HTTP protocol route covers the workbench catalog). The
 * session machinery is reused from the built `@nervekit/protocol` package;
 * repository scripts cannot import workspace packages by name, so it is loaded
 * from `packages/*\/dist` at runtime. Authentication is the slot's own
 * `secrets/daemon-token` bearer (accepted from loopback only).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { CliError } from "../../cli/main.ts";
import { resolveStorageSlot } from "../../development/storage-slot.ts";
import { repoRoot } from "../../workspace/repo.ts";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Time-sortable id in the daemon's format (`conv_<10 time><16 random>`). */
export function createId(prefix: string): string {
  let time = Date.now();
  let head = "";
  for (let index = 0; index < 10; index++) {
    head = CROCKFORD[time % 32]! + head;
    time = Math.floor(time / 32);
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}_${head}${Array.from(random, (byte) => CROCKFORD[byte % 32]).join("")}`;
}

/** Import a built workspace module (`packages/<pkg>/dist/<file>`) by path. */
export async function importBuilt<T = Record<string, unknown>>(
  pkg: string,
  file: string,
): Promise<T> {
  const path = join(repoRoot, "packages", pkg, "dist", file);
  try {
    return (await import(pathToFileURL(path).href)) as T;
  } catch (cause) {
    throw new CliError(
      `Cannot load ${path}; run \`pnpm build\` for the workspace first (${cause instanceof Error ? cause.message : String(cause)}).`,
    );
  }
}

export interface SlotTarget {
  readonly slot: number;
  readonly home: string;
  readonly baseUrl: string;
}

/** Resolve a dev slot. Slot 1 hosts live sessions and is never a benchmark target. */
export function resolveSlotTarget(slot: number): SlotTarget {
  if (!Number.isInteger(slot) || slot < 2 || slot > 100)
    throw new CliError("--slot must be an integer from 2 to 100 (never 1).");
  const resolved = resolveStorageSlot(["--slot", String(slot)]);
  return {
    slot,
    home: resolved.home,
    baseUrl: `http://127.0.0.1:${resolved.httpPort}`,
  };
}

interface ClientConnection {
  state: string;
  session: { state: string };
  start(): Promise<void>;
  request(
    method: string,
    params: unknown,
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
  close(): Promise<void>;
}

export class DaemonClient {
  private constructor(
    readonly target: SlotTarget,
    readonly token: string,
    private readonly connection: ClientConnection,
  ) {}

  /** Check health, read the slot token and open the conversation channel. */
  static async connect(target: SlotTarget): Promise<DaemonClient> {
    const token = (
      await readFile(
        join(target.home, "secrets", "daemon-token"),
        "utf8",
      ).catch(() => {
        throw new CliError(
          `No daemon token at ${target.home}/secrets/daemon-token; has slot ${target.slot} been started?`,
        );
      })
    ).trim();
    const health = await fetch(`${target.baseUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
    if (!health?.ok)
      throw new CliError(
        `Slot ${target.slot} is not running at ${target.baseUrl}. Start it with the launch tool or the nerve-qa scripts; this harness never starts daemons.`,
      );

    const client = await importBuilt<{
      ProtocolClientConnection: new (options: unknown) => ClientConnection;
      ProtocolClientSession: new (options: unknown) => unknown;
    }>("protocol", "client.js");
    const adapters = await importBuilt<{
      nodeWebSocketTransportFactory: (connect: () => unknown) => unknown;
    }>("protocol", "adapters/index.js");
    const protocol = await importBuilt<{
      createMessageFactory: (defaults: unknown) => unknown;
    }>("protocol", "index.js");
    const core = await importBuilt<{
      conversationChannelOperations: { requiredCapability?: string }[];
    }>("contracts", "domains/core/index.js");

    const capabilities = [
      "encoding.json",
      "event.notify",
      "stream.subscription.v1",
      ...core.conversationChannelOperations
        .map((operation) => operation.requiredCapability)
        .filter((value): value is string => Boolean(value)),
    ];
    const messages = protocol.createMessageFactory({
      source: {
        role: "ui",
        id: `cli_bench${Date.now().toString(36)}`,
        instanceId: `bench_${process.pid}`,
        name: "Extensions benchmark",
      },
      target: { role: "workbench_server" },
    });
    const wsUrl = new URL("/ws/conversations", target.baseUrl);
    wsUrl.protocol = "ws:";
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((yes, no) => {
      resolveReady = yes;
      rejectReady = no;
    });
    const connection = new client.ProtocolClientConnection({
      transport: adapters.nodeWebSocketTransportFactory(
        () =>
          new WebSocket(wsUrl, {
            headers: { authorization: `Bearer ${token}` },
          }),
      ),
      onError: (error: unknown) => rejectReady(error),
      createSession: ({
        send,
        onDisconnect,
      }: {
        send: unknown;
        onDisconnect: unknown;
      }) =>
        new client.ProtocolClientSession({
          createMessage: messages,
          capabilities,
          requiredCapabilities: ["encoding.json", "event.notify"],
          cursors: () => [],
          send,
          onDisconnect,
          onReady: () => resolveReady(),
          onSnapshotRequired: () => undefined,
          onStreamUnavailable: () => undefined,
          applyEvent: () => undefined,
          onNotify: () => undefined,
        }),
    });
    await connection.start();
    await Promise.race([
      ready,
      new Promise((_, no) =>
        setTimeout(
          () => no(new Error("conversation channel handshake timed out")),
          15_000,
        ),
      ),
    ]);
    return new DaemonClient(target, token, connection);
  }

  /** Call one operation of the conversation channel. */
  call<T = unknown>(
    method: string,
    params: unknown = {},
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    return this.connection.request(method, params, {
      timeoutMs: options.timeoutMs ?? 60_000,
    }) as Promise<T>;
  }

  async close(): Promise<void> {
    await this.connection.close().catch(() => undefined);
  }
}
