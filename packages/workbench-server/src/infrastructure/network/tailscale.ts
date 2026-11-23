import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

/*
 * Tailscale CLI adapter for the private tunnel. Parsing is pure and tested;
 * `createTailscaleCli` only runs the binary. Nerve never runs `sudo`: missing
 * permissions become a problem the user fixes once.
 */

/** Where the app bundle keeps the CLI when it is not on PATH. */
const PLATFORM_CANDIDATES: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ["/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
  win32: ["C:\\Program Files\\Tailscale\\tailscale.exe"],
};

export async function locateTailscale(
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    isExecutable?: (path: string) => Promise<boolean>;
  } = {},
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const isExecutable = options.isExecutable ?? executable;
  const name = platform === "win32" ? "tailscale.exe" : "tailscale";
  const onPath = (env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, name));
  for (const candidate of [...onPath, ...(PLATFORM_CANDIDATES[platform] ?? [])])
    if (await isExecutable(candidate)) return candidate;
  return undefined;
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface TailscaleNode {
  running: boolean;
  /** MagicDNS name without the trailing dot, e.g. `pc.tail1234.ts.net`. */
  dnsName?: string;
  /** Names Tailscale can issue certificates for; empty until HTTPS is enabled. */
  certDomains: string[];
}

export function parseTailscaleStatus(json: unknown): TailscaleNode {
  const status = (json ?? {}) as {
    BackendState?: unknown;
    Self?: { DNSName?: unknown };
    CertDomains?: unknown;
  };
  const rawName = status.Self?.DNSName;
  const dnsName =
    typeof rawName === "string" && rawName
      ? rawName.replace(/\.$/, "").toLowerCase()
      : undefined;
  const certDomains = Array.isArray(status.CertDomains)
    ? status.CertDomains.filter(
        (entry): entry is string => typeof entry === "string",
      ).map((entry) => entry.toLowerCase())
    : [];
  return { running: status.BackendState === "Running", dnsName, certDomains };
}

export type TailscaleProblem =
  | { code: "not_installed" }
  | { code: "not_running" }
  | { code: "no_magic_dns" }
  | { code: "serve_not_enabled"; approvalUrl?: string }
  | { code: "permission_denied" }
  | { code: "port_in_use"; httpsPort: number }
  | { code: "funnel_enabled"; httpsPort: number }
  | { code: "command_failed"; detail: string };

/** What blocks the tunnel before anything is changed, if anything. */
export function nodeProblem(node: TailscaleNode): TailscaleProblem | undefined {
  if (!node.running) return { code: "not_running" };
  if (!node.dnsName) return { code: "no_magic_dns" };
  if (!node.certDomains.includes(node.dnsName))
    return { code: "serve_not_enabled" };
  return undefined;
}

/** The approval link `tailscale serve` prints (and waits on) when Serve is off. */
export function extractApprovalUrl(output: string): string | undefined {
  return output.match(/https:\/\/login\.tailscale\.com\/f\/serve\?\S+/)?.[0];
}

export function isPermissionDenied(output: string): boolean {
  return /access denied|permission denied|must be root|use 'sudo/i.test(output);
}

export type ServeEntry =
  /** Nothing is served on this HTTPS port. */
  | { kind: "absent" }
  /** This port proxies to our listener. */
  | { kind: "ours"; funnel: boolean }
  /** Something else owns this port; never overwrite it. */
  | { kind: "other" };

/**
 * Reads `tailscale serve status --json` for one HTTPS port. Shape (1.104):
 * `TCP["443"].HTTPS`, `Web["host:443"].Handlers["/"].Proxy`, `AllowFunnel["host:443"]`.
 */
export function findServeEntry(
  json: unknown,
  input: { host: string; httpsPort: number; target: string },
): ServeEntry {
  const status = (json ?? {}) as {
    TCP?: Record<string, unknown>;
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: unknown }> }>;
    AllowFunnel?: Record<string, unknown>;
  };
  const key = `${input.host}:${input.httpsPort}`;
  const web = status.Web?.[key];
  if (!status.TCP?.[String(input.httpsPort)] && !web) return { kind: "absent" };
  const handlers = Object.entries(web?.Handlers ?? {});
  const ours =
    handlers.length === 1 &&
    handlers[0]?.[0] === "/" &&
    normalizeProxy(handlers[0][1].Proxy) === normalizeProxy(input.target);
  if (!ours) return { kind: "other" };
  return { kind: "ours", funnel: status.AllowFunnel?.[key] === true };
}

function normalizeProxy(value: unknown): string {
  return typeof value === "string" ? value.replace(/\/$/, "") : "";
}

export type ServeOutcome =
  | { kind: "ok" }
  | { kind: "problem"; problem: TailscaleProblem };

export interface TailscaleCli {
  status(): Promise<TailscaleNode>;
  serveStatus(): Promise<unknown>;
  /** Adds `https:<httpsPort> → target` in the background. */
  serve(httpsPort: number, target: string): Promise<ServeOutcome>;
  /** Removes whatever serves `httpsPort`; callers check it is ours first. */
  serveOff(httpsPort: number): Promise<ServeOutcome>;
}

type RunResult = { code: number | null; output: string; timedOut: boolean };

/** Runs the CLI; stops early once `stopWhen` matches the combined output. */
function run(
  binary: string,
  args: string[],
  options: { timeoutMs: number; stopWhen?: (output: string) => boolean },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ code: null, output, timedOut: true }),
      options.timeoutMs,
    );
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (options.stopWhen?.(output))
        finish({ code: null, output, timedOut: false });
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) =>
      finish({ code: -1, output: output + String(error), timedOut: false }),
    );
    child.on("close", (code) => finish({ code, output, timedOut: false }));
  });
}

function outcome(result: RunResult): ServeOutcome {
  const approvalUrl = extractApprovalUrl(result.output);
  if (approvalUrl)
    return {
      kind: "problem",
      problem: { code: "serve_not_enabled", approvalUrl },
    };
  if (isPermissionDenied(result.output))
    return { kind: "problem", problem: { code: "permission_denied" } };
  if (result.timedOut || result.code !== 0)
    return {
      kind: "problem",
      problem: {
        code: "command_failed",
        detail: result.timedOut
          ? "tailscale did not respond"
          : result.output.trim().split("\n").at(-1) || "tailscale failed",
      },
    };
  return { kind: "ok" };
}

const COMMAND_TIMEOUT_MS = 20_000;

export function createTailscaleCli(binary: string): TailscaleCli {
  const json = async (args: string[]): Promise<unknown> => {
    const result = await run(binary, args, { timeoutMs: COMMAND_TIMEOUT_MS });
    if (result.code !== 0)
      throw new Error(result.output.trim() || `tailscale ${args.join(" ")}`);
    return JSON.parse(result.output) as unknown;
  };
  return {
    status: async () => parseTailscaleStatus(await json(["status", "--json"])),
    serveStatus: () => json(["serve", "status", "--json"]),
    serve: async (httpsPort, target) =>
      outcome(
        await run(
          binary,
          ["serve", "--bg", "--yes", `--https=${httpsPort}`, target],
          {
            timeoutMs: COMMAND_TIMEOUT_MS,
            // Unapproved Serve blocks on this link; return it instead of waiting.
            stopWhen: (output) => extractApprovalUrl(output) !== undefined,
          },
        ),
      ),
    serveOff: async (httpsPort) =>
      outcome(
        await run(binary, ["serve", `--https=${httpsPort}`, "off"], {
          timeoutMs: COMMAND_TIMEOUT_MS,
        }),
      ),
  };
}
