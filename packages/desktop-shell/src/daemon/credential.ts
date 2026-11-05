import type { DaemonMode, DaemonPaths } from "./contracts.js";
import { DaemonAccessError, type DaemonRuntimePorts } from "./ports.js";

/**
 * The bearer the shell uses for one daemon, and how it stays valid: a local
 * daemon's token is re-read from disk when it is rejected (local token
 * rotation rewrites it), a remote device credential follows the server's
 * `x-nerve-credential` rotation and is persisted per origin.
 */
export class DaemonCredential {
  token?: string;
  private readonly listeners = new Set<() => void>();
  private refreshing?: Promise<boolean>;
  private closed = false;

  constructor(
    private readonly options: {
      mode: DaemonMode;
      paths?: DaemonPaths;
      url: () => string;
      ports: Pick<DaemonRuntimePorts, "discovery" | "credentials" | "logger">;
    },
  ) {}

  close(): void {
    this.closed = true;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(token: string): void {
    if (token === this.token) return;
    this.token = token;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        this.options.ports.logger.log(
          "warn",
          "Daemon credential listener failed",
          { error },
        );
      }
    }
  }

  /** Adopts a server-rotated device credential and persists it for next launch. */
  accept(credential: string): void {
    if (this.closed || !credential || credential === this.token) return;
    this.set(credential);
    const { mode, ports, url } = this.options;
    if (mode !== "remote" || !url()) return;
    void ports.credentials
      .save(new URL(url()).origin, credential)
      .catch((error) =>
        ports.logger.log(
          "warn",
          "Could not store the rotated device credential",
          { error },
        ),
      );
  }

  /** The daemon rejected the credential; true when a different one was found. */
  refresh(): Promise<boolean> {
    const { mode, paths, ports } = this.options;
    if (mode !== "local" || !paths) return Promise.resolve(false);
    this.refreshing ??= ports.discovery
      .readLocalToken(paths)
      .then((token) => {
        const changed = token !== this.token;
        this.set(token);
        return changed;
      })
      .catch((error) => {
        ports.logger.log("warn", "Could not re-read the daemon token", {
          error,
        });
        return false;
      })
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  /** Runs an authenticated call, retrying once with a re-read token after a 401. */
  async withRetry<T>(call: (token: string) => Promise<T>): Promise<T> {
    if (!this.token) throw new Error("The Nerve daemon is not connected.");
    try {
      return await call(this.token);
    } catch (error) {
      if (
        error instanceof DaemonAccessError &&
        error.status === 401 &&
        (await this.refresh()) &&
        this.token
      ) {
        return call(this.token);
      }
      throw error;
    }
  }
}
