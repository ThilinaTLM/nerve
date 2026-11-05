import { readFile } from "node:fs/promises";
import { daemonFileSchema } from "@nervekit/contracts/status";
import type { PairingCode } from "@nervekit/contracts/access";
import {
  readDevicesFile,
  resolveDataDir,
  storagePaths,
  writeDevicesFile,
} from "../infrastructure/storage-bootstrap/index.js";

/**
 * `nerve pair [--purpose mobile|browser|desktop] [--ttl SECONDS] [--enroll]`
 * `nerve access reset`
 *
 * Both are filesystem-gated like the local token: they authenticate to the
 * running daemon with `secrets/daemon-token` (same OS user), over loopback.
 */
export function isAccessCliCommand(argv: readonly string[]): boolean {
  return argv[0] === "pair" || (argv[0] === "access" && argv[1] === "reset");
}

interface Output {
  log(line: string): void;
  error(line: string): void;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function daemonEndpoint(
  home: string,
): Promise<{ url: string; token: string } | undefined> {
  const paths = storagePaths(home);
  try {
    const daemon = daemonFileSchema.parse(
      JSON.parse(await readFile(paths.daemonPath, "utf8")),
    );
    const token = (await readFile(paths.localTokenPath, "utf8")).trim();
    // The CLI runs on the daemon host: always talk to loopback.
    return { url: `http://127.0.0.1:${daemon.port}`, token };
  } catch {
    return undefined;
  }
}

async function post<T>(
  endpoint: { url: string; token: string },
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${endpoint.url}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return payload as T;
}

function printCode(code: PairingCode, out: Output): void {
  const minutes = Math.max(
    1,
    Math.round((code.expiresAt - Date.now()) / 60_000),
  );
  out.log(
    `${code.purpose === "setup" ? "Passkey setup code" : "Pairing code"}: ${code.code}`,
  );
  out.log(
    `Valid for about ${minutes} minute${minutes === 1 ? "" : "s"}, single use.`,
  );
  if (code.url) out.log(`Open: ${code.url}`);
  else
    out.log(
      "Open the Nerve web UI on the new device and choose “Pair this device”, or scan the QR from Settings → Devices.",
    );
}

export async function runAccessCli(
  argv: readonly string[],
  out: Output = { log: console.log, error: console.error },
): Promise<number> {
  const home = resolveDataDir();
  const endpoint = await daemonEndpoint(home);
  try {
    if (argv[0] === "pair") {
      if (!endpoint) {
        out.error(
          "No running Nerve daemon found for this home. Start it first.",
        );
        return 1;
      }
      if (argv.includes("--enroll")) {
        printCode(
          await post<PairingCode>(endpoint, "/api/access/setup-code", {}),
          out,
        );
        return 0;
      }
      const purpose = flag(argv, "--purpose") ?? "browser";
      const ttl = flag(argv, "--ttl");
      printCode(
        await post<PairingCode>(endpoint, "/api/access/pairing-codes", {
          purpose,
          ...(ttl ? { ttlSeconds: Number(ttl) } : {}),
        }),
        out,
      );
      return 0;
    }
    // access reset
    if (endpoint) {
      const code = await post<PairingCode>(endpoint, "/api/access/reset", {});
      out.log("Owner passkeys cleared.");
      printCode(code, out);
      return 0;
    }
    // Daemon stopped: clear the file directly; the next start prints a setup code.
    const path = storagePaths(home).devicesPath;
    const file = await readDevicesFile(path);
    file.owner = undefined;
    await writeDevicesFile(path, file);
    out.log(
      "Owner passkeys cleared. A new setup code is printed when the daemon starts.",
    );
    return 0;
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
