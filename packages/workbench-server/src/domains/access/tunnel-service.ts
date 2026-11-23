import type { TunnelProblem, TunnelStatus } from "@nervekit/contracts/access";
import type { TunnelSettings } from "@nervekit/contracts/settings";
import {
  findServeEntry,
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
  /** Persists the listener port so the Serve entry survives restarts. */
  saveListenerPort(port: number): Promise<void>;
  /** Waits for the first HTTPS response (certificate issuance); false on timeout. */
  warmUp(url: string): Promise<boolean>;
  /** Called with the origin requests must be resolved against, or undefined. */
  setOrigin(origin: URL | undefined): void;
  publish(status: TunnelStatus): void;
  logger?: { warn(message: string, context?: Record<string, unknown>): void };
}

type Active = {
  listener: TunnelListener;
  cli: TailscaleCli;
  host: string;
  httpsPort: number;
  target: string;
};

/**
 * Private remote access through Tailscale Serve. `apply` brings the tunnel in
 * line with the saved settings; calls are serialized. Nerve only ever removes
 * the Serve entry it recognizes as its own (same port, proxy to our listener).
 */
export class TunnelService {
  #status: TunnelStatus = { state: "off" };
  #active: Active | undefined;
  #applied: { enabled: boolean; httpsPort: number } = {
    enabled: false,
    httpsPort: 443,
  };
  #queue: Promise<void> = Promise.resolve();

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
      await this.#stop();
      if (enabled) await this.#start(httpsPort, settings?.listenerPort);
    });
  }

  /**
   * Daemon shutdown: close the listener but keep the Serve entry, so the next
   * start finds its own entry instead of re-adding it.
   */
  close(): Promise<void> {
    return this.#serialize(async () => {
      const active = this.#active;
      this.#active = undefined;
      this.deps.setOrigin(undefined);
      await active?.listener.close();
    });
  }

  #serialize(task: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(task, task);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #set(status: TunnelStatus): void {
    this.#status = status;
    this.deps.publish(status);
  }

  #fail(problem: TunnelProblem): void {
    this.deps.logger?.warn("Private tunnel unavailable", { problem });
    this.#set({ state: "problem", problem });
  }

  async #start(httpsPort: number, savedPort: number | undefined) {
    this.#set({ state: "starting" });
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
    if (listener.port !== savedPort)
      await this.deps.saveListenerPort(listener.port);
    const target = `http://127.0.0.1:${listener.port}`;

    const abandon = async (problem: TunnelProblem) => {
      await listener.close();
      this.#fail(problem);
    };

    let entry;
    try {
      entry = findServeEntry(await cli.serveStatus(), {
        host,
        httpsPort,
        target,
      });
    } catch (error) {
      return abandon({ code: "command_failed", detail: String(error) });
    }
    if (entry.kind === "other")
      return abandon({ code: "port_in_use", httpsPort });
    if (entry.kind === "ours" && entry.funnel)
      return abandon({ code: "funnel_enabled", httpsPort });
    if (entry.kind === "absent") {
      const added = await cli.serve(httpsPort, target);
      if (added.kind === "problem") return abandon(added.problem);
    }

    this.#active = { listener, cli, host, httpsPort, target };
    const url =
      httpsPort === 443 ? `https://${host}` : `https://${host}:${httpsPort}`;
    this.deps.setOrigin(new URL(url));
    this.#set({ state: "certificate", url });
    // Outside the queue: issuance takes tens of seconds and must not delay Off.
    void this.#warmUp(listener, url);
  }

  async #warmUp(listener: TunnelListener, url: string) {
    if (!(await this.deps.warmUp(url)))
      this.deps.logger?.warn("Private tunnel certificate not ready yet", {
        url,
      });
    // Still ours? A later apply may have replaced or stopped it meanwhile.
    if (this.#active?.listener === listener) this.#set({ state: "ready", url });
  }

  async #stop() {
    const active = this.#active;
    this.#active = undefined;
    this.deps.setOrigin(undefined);
    if (active) {
      try {
        const entry = findServeEntry(await active.cli.serveStatus(), {
          host: active.host,
          httpsPort: active.httpsPort,
          target: active.target,
        });
        if (entry.kind === "ours") {
          const removed = await active.cli.serveOff(active.httpsPort);
          if (removed.kind === "problem")
            this.deps.logger?.warn("Could not remove the Serve entry", {
              problem: removed.problem,
            });
        }
      } catch (error) {
        this.deps.logger?.warn("Could not check the Serve entry", {
          error: String(error),
        });
      }
      await active.listener.close();
    }
    if (this.#status.state !== "off") this.#set({ state: "off" });
  }
}
