import { SerialQueue } from "@nervekit/primitives";
import type { TunnelProblem, TunnelStatus } from "@nervekit/contracts/access";
import type { TunnelSettings } from "@nervekit/contracts/settings";
import {
  findServeEntry,
  funnelExposes,
  nodeProblem,
  type TailscaleCli,
} from "../../infrastructure/network/tailscale.js";

/** The loopback listener Tailscale Serve proxies to. */
export interface TunnelListener {
  port: number;
  close(): Promise<void>;
}

export interface TunnelServiceDeps {
  /** The CLI, or undefined when Tailscale is not installed. */
  cli(): Promise<TailscaleCli | undefined>;
  /** Opens the listener on `port`, or any free loopback port when undefined or taken. */
  openListener(port: number | undefined): Promise<TunnelListener>;
  /** Persists the listener port, so a later run can recognize its own leftover Serve entry. */
  saveListenerPort(port: number): Promise<void>;
  /** Waits for the first HTTPS response (certificate issuance); false on timeout. */
  warmUp(url: string): Promise<boolean>;
  /** Called with the origin requests must be resolved against, or undefined. */
  setOrigin(origin: URL | undefined): void;
  publish(status: TunnelStatus): void;
  logger?: { warn(message: string, context?: Record<string, unknown>): void };
  /** How often an active tunnel re-checks `serve status`; default 60 s. */
  driftIntervalMs?: number;
}

const DRIFT_INTERVAL_MS = 60_000;
/** Shutdown must not hang on a stuck CLI. */
const CLOSE_CLEANUP_MS = 5_000;

type Active = {
  listener: TunnelListener;
  cli: TailscaleCli;
  host: string;
  httpsPort: number;
  target: string;
  drift?: ReturnType<typeof setInterval>;
};

type ServeRef = Pick<Active, "cli" | "host" | "httpsPort" | "target">;

/**
 * Private remote access through Tailscale Serve. `apply` brings the tunnel in
 * line with the saved settings; calls are serialized. Nerve only ever removes
 * the Serve entry it recognizes as its own (same port, proxy to our listener,
 * or to the listener port of its previous run). The entry never outlives the
 * daemon except after a crash: Off and shutdown both remove it.
 */
export class TunnelService {
  #status: TunnelStatus = { state: "off" };
  #active: Active | undefined;
  /** Our entry that could not be removed; the next stop or close retries. */
  #leftover: ServeRef | undefined;
  #applied: { enabled: boolean; httpsPort: number } = {
    enabled: false,
    httpsPort: 443,
  };
  #queue = new SerialQueue();

  constructor(private readonly deps: TunnelServiceDeps) {}

  get status(): TunnelStatus {
    return this.#status;
  }

  /**
   * Enable, disable or move the tunnel to match `settings`. Applying the same
   * settings again retries after a problem (the user approved Serve, started
   * tailscaled…).
   */
  apply(settings: TunnelSettings | undefined): Promise<void> {
    return this.#serialize(async () => {
      const enabled = settings?.enabled ?? false;
      const httpsPort = settings?.httpsPort ?? 443;
      const changed =
        enabled !== this.#applied.enabled ||
        httpsPort !== this.#applied.httpsPort;
      this.#applied = { enabled, httpsPort };
      // Same settings and already working (or deliberately off): nothing to do.
      if (!changed && this.#status.state !== "problem") return;
      if (!(await this.#stop())) return;
      if (enabled) await this.#start(httpsPort, settings?.listenerPort);
    });
  }

  /**
   * Daemon shutdown: close the listener, then remove our Serve entry (bounded,
   * best effort) so Serve never routes tailnet traffic to a port someone else
   * may take over.
   */
  close(): Promise<void> {
    return this.#serialize(async () => {
      const active = this.#active;
      this.#detach(active);
      await active?.listener.close();
      const entry = active ?? this.#leftover;
      if (!entry) return;
      this.#leftover = undefined;
      const problem = await withTimeout(
        this.#removeEntry(entry),
        CLOSE_CLEANUP_MS,
        { code: "command_failed", detail: "tailscale did not respond" },
      );
      if (problem) {
        this.#leftover = entry;
        this.#fail(problem);
      }
    });
  }

  #serialize(task: () => Promise<void>): Promise<void> {
    return this.#queue.run(task);
  }

  #set(status: TunnelStatus): void {
    this.#status = status;
    this.deps.publish(status);
  }

  #fail(problem: TunnelProblem): void {
    this.deps.logger?.warn("Private tunnel unavailable", { problem });
    this.#set({ state: "problem", problem });
  }

  /** Stops serving requests: nothing resolves against the tunnel origin any more. */
  #detach(active: Active | undefined): void {
    this.#active = undefined;
    if (active?.drift) clearInterval(active.drift);
    this.deps.setOrigin(undefined);
  }

  /** Removes the Serve entry when it is ours; returns what went wrong, if anything. */
  async #removeEntry(
    ref: ServeRef,
    previousTarget?: string,
  ): Promise<TunnelProblem | undefined> {
    try {
      const entry = findServeEntry(await ref.cli.serveStatus(), {
        host: ref.host,
        httpsPort: ref.httpsPort,
        target: ref.target,
        previousTarget,
      });
      if (entry.kind !== "ours" && entry.kind !== "stale") return undefined;
      const removed = await ref.cli.serveOff(ref.httpsPort);
      return removed.kind === "problem" ? removed.problem : undefined;
    } catch (error) {
      return { code: "command_failed", detail: String(error) };
    }
  }

  async #start(httpsPort: number, savedPort: number | undefined) {
    this.#set({ state: "starting" });
    const opened: { listener?: TunnelListener } = {};
    try {
      await this.#begin(httpsPort, savedPort, opened);
    } catch (error) {
      if (opened.listener && this.#active?.listener !== opened.listener)
        await opened.listener.close().catch(() => undefined);
      this.#fail({ code: "command_failed", detail: String(error) });
    }
  }

  async #begin(
    httpsPort: number,
    savedPort: number | undefined,
    opened: { listener?: TunnelListener },
  ) {
    const cli = await this.deps.cli();
    if (!cli) return this.#fail({ code: "not_installed" });

    let node;
    try {
      node = await cli.status();
    } catch (error) {
      // `tailscale status` fails outright when tailscaled is not running.
      return this.#fail(
        /tailscaled|connect/i.test(String(error))
          ? { code: "not_running" }
          : { code: "command_failed", detail: String(error) },
      );
    }
    const blocked = nodeProblem(node);
    if (blocked || !node.dnsName)
      return this.#fail(blocked ?? { code: "no_magic_dns" });
    const host = node.dnsName;

    const listener = await this.deps.openListener(savedPort);
    opened.listener = listener;
    if (listener.port !== savedPort)
      await this.deps.saveListenerPort(listener.port);
    const target = `http://127.0.0.1:${listener.port}`;
    const ref: ServeRef = { cli, host, httpsPort, target };

    const abandon = async (problem: TunnelProblem, removeOurs = false) => {
      await listener.close();
      if (removeOurs) await this.#removeEntry(ref);
      this.#fail(problem);
    };

    let status: unknown;
    try {
      status = await cli.serveStatus();
    } catch (error) {
      return abandon({ code: "command_failed", detail: String(error) });
    }
    const entry = findServeEntry(status, {
      host,
      httpsPort,
      target,
      previousTarget:
        savedPort !== undefined && savedPort !== listener.port
          ? `http://127.0.0.1:${savedPort}`
          : undefined,
    });
    if (entry.kind === "other")
      return abandon({ code: "port_in_use", httpsPort });
    if (funnelExposes(status, target))
      return abandon(
        { code: "funnel_enabled", httpsPort },
        entry.kind === "ours",
      );
    if (entry.kind === "stale") {
      // Our own leftover from before the listener moved to another port.
      const removed = await cli.serveOff(httpsPort);
      if (removed.kind === "problem") return abandon(removed.problem);
    }
    if (entry.kind === "absent" || entry.kind === "stale") {
      const added = await cli.serve(httpsPort, target);
      if (added.kind === "problem") return abandon(added.problem);
    }

    const active: Active = { listener, ...ref };
    this.#active = active;
    const url =
      httpsPort === 443 ? `https://${host}` : `https://${host}:${httpsPort}`;
    this.deps.setOrigin(new URL(url));
    this.#set({ state: "certificate", url });
    this.#watch(active);
    // Outside the queue: issuance takes tens of seconds and must not delay Off.
    void this.#warmUp(active, url).catch((error) =>
      this.deps.logger?.warn("Private tunnel warm-up failed", {
        error: String(error),
      }),
    );
  }

  async #warmUp(active: Active, url: string) {
    const ready = await this.deps.warmUp(url);
    // Still ours? A later apply may have replaced or stopped it meanwhile.
    if (this.#active !== active) return;
    // On timeout the tunnel stays up: Try again restarts it, and a late
    // certificate still works.
    if (ready) this.#set({ state: "ready", url });
    else
      this.#fail({
        code: "command_failed",
        detail: "Tailscale could not get a certificate",
      });
  }

  /** While active, re-check that the Serve entry is still ours and private. */
  #watch(active: Active) {
    const timer = setInterval(
      () =>
        void this.#serialize(() => this.#checkDrift(active)).catch((error) =>
          this.deps.logger?.warn("Serve status check failed", {
            error: String(error),
          }),
        ),
      this.deps.driftIntervalMs ?? DRIFT_INTERVAL_MS,
    );
    timer.unref();
    active.drift = timer;
  }

  async #checkDrift(active: Active) {
    if (this.#active !== active) return;
    let status: unknown;
    try {
      status = await active.cli.serveStatus();
    } catch (error) {
      // A busy or restarting tailscaled is not a change of the entry.
      this.deps.logger?.warn("Could not check the Serve entry", {
        error: String(error),
      });
      return;
    }
    if (this.#active !== active) return;
    const entry = findServeEntry(status, active);
    const funnel = funnelExposes(status, active.target);
    if (!funnel && entry.kind === "ours") return;
    this.#detach(active);
    await active.listener.close();
    if (entry.kind === "ours") await this.#removeEntry(active);
    this.#fail(
      funnel
        ? { code: "funnel_enabled", httpsPort: active.httpsPort }
        : { code: "entry_changed" },
    );
  }

  /** Returns false when our Serve entry could not be removed (a problem is published). */
  async #stop(): Promise<boolean> {
    const active = this.#active;
    // Cut tunnel clients off first; the CLI can take seconds.
    this.#detach(active);
    await active?.listener.close();
    const entry = active ?? this.#leftover;
    this.#leftover = undefined;
    const problem = entry ? await this.#removeEntry(entry) : undefined;
    if (entry && problem) {
      this.#leftover = entry;
      this.#fail(problem);
      return false;
    }
    if (this.#status.state !== "off") this.#set({ state: "off" });
    return true;
  }
}

async function withTimeout<T>(
  task: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    timer.unref();
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
