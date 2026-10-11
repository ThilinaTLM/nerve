import { readFile } from "node:fs/promises";

export async function waitForOutputReadiness(
  background: {
    outputFiles: { stdout: string; combined?: string };
    wait(): Promise<unknown>;
    cancel(): Promise<void>;
  },
  input: {
    signal: AbortSignal;
    ready:
      | { kind: "pattern"; pattern: string; timeoutMs?: number }
      | { kind: "url"; url: string; timeoutMs?: number }
      | { kind: "detected_url"; timeoutMs?: number };
  },
) {
  const ready = input.ready;
  const pattern =
    ready.kind === "pattern" ? new RegExp(ready.pattern) : undefined;
  let exited = false;
  void background.wait().then(
    () => {
      exited = true;
    },
    () => {
      exited = true;
    },
  );
  const deadline = Date.now() + Math.min(ready.timeoutMs ?? 60_000, 60_000);
  while (Date.now() < deadline && !exited && !input.signal.aborted) {
    const output = await readFile(
      background.outputFiles.combined ?? background.outputFiles.stdout,
      "utf8",
    ).catch(() => "");
    if (pattern?.test(output)) return { status: "ready" as const };
    const url =
      ready.kind === "url"
        ? ready.url
        : ready.kind === "detected_url"
          ? // eslint-disable-next-line no-control-regex -- terminal output may contain ANSI escapes.
            output.match(/https?:\/\/[^\s\x1b]+/)?.[0]
          : undefined;
    if (url) {
      try {
        await probeReadinessUrl(
          url,
          AbortSignal.any([input.signal, AbortSignal.timeout(1000)]),
          true,
        );
        return {
          status: "ready" as const,
          url,
        };
      } catch {
        /* Readiness can lag process startup. */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (input.signal.aborted) {
    await background.cancel();
    throw new DOMException("Cancelled", "AbortError");
  }
  return {
    status: exited ? ("exited" as const) : ("timed_out" as const),
  };
}

interface OutputReadinessRequest {
  readyPattern?: string;
  readyOnUrl?: boolean;
  readyUrl?: string;
  readyTimeoutMs?: number;
}

export class OutputReadinessCoordinator {
  private readonly output = new Map<string, string>();
  private readonly waiters = new Map<
    string,
    {
      request: OutputReadinessRequest;
      pattern?: RegExp;
      resolve: (
        value: "ready" | "timeout" | { outcome: "ready"; matched?: string },
      ) => void;
    }
  >();

  forget(launchId: string): void {
    this.output.delete(launchId);
    this.waiters.get(launchId)?.resolve("timeout");
    this.waiters.delete(launchId);
  }

  capture(launchId: string, text: string): void {
    const combined = `${this.output.get(launchId) ?? ""}${text}`.slice(
      -256 * 1024,
    );
    this.output.set(launchId, combined);
    this.match(launchId, combined);
  }

  async wait(launch: { id: string }, request: OutputReadinessRequest) {
    const pattern = request.readyPattern
      ? new RegExp(request.readyPattern, "i")
      : undefined;
    const immediate = this.matchValue(
      request,
      this.output.get(launch.id) ?? "",
      pattern,
    );
    if (immediate) return { outcome: "ready" as const, matched: immediate };
    const timeoutMs =
      request.readyTimeoutMs ?? (request.readyUrl ? 30_000 : 3_000);
    return new Promise<"timeout" | { outcome: "ready"; matched?: string }>(
      (resolve) => {
        let settled = false;
        const finish = (
          value: "ready" | "timeout" | { outcome: "ready"; matched?: string },
        ) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.waiters.delete(launch.id);
          resolve(value === "ready" ? { outcome: "ready" } : value);
        };
        this.waiters.set(launch.id, { request, pattern, resolve: finish });
        const timer = setTimeout(() => finish("timeout"), timeoutMs);
        if (request.readyUrl)
          void this.pollUrl(request.readyUrl, finish, timeoutMs);
      },
    );
  }

  private match(launchId: string, text: string): void {
    const waiter = this.waiters.get(launchId);
    if (!waiter) return;
    const matched = this.matchValue(waiter.request, text, waiter.pattern);
    if (matched) waiter.resolve({ outcome: "ready", matched });
  }

  private matchValue(
    request: OutputReadinessRequest,
    text: string,
    pattern?: RegExp,
  ): string | undefined {
    if (request.readyOnUrl) {
      const url = text.match(/https?:\/\/[^\s)'"]+/i)?.[0];
      if (url && !url.endsWith(":")) return url;
    }
    if (pattern) {
      const matched = pattern.exec(text)?.[0];
      if (matched) return matched;
    }
    return undefined;
  }

  private async pollUrl(
    url: string,
    finish: (
      value: "ready" | "timeout" | { outcome: "ready"; matched?: string },
    ) => void,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        await probeReadinessUrl(
          url,
          AbortSignal.timeout(Math.min(500, timeoutMs)),
        );
        finish({ outcome: "ready", matched: url });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
}

async function probeReadinessUrl(
  url: string,
  signal: AbortSignal,
  releaseBody = false,
): Promise<void> {
  const response = await fetch(url, { signal });
  if (releaseBody) await response.body?.cancel();
}
