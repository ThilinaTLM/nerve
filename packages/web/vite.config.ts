import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

function nerveHome(env: Record<string, string>): string {
  return env.NERVE_HOME?.trim() || path.join(homedir(), ".nerve");
}

function readText(pathname: string): string | undefined {
  try {
    return readFileSync(pathname, "utf8").trim();
  } catch {
    return undefined;
  }
}

function readDaemonUrl(home: string): string | undefined {
  const raw = readText(path.join(home, "daemon.json"));
  if (!raw) return undefined;
  try {
    const daemon = JSON.parse(raw) as { url?: unknown; stale?: unknown };
    return typeof daemon.url === "string" && daemon.stale !== true
      ? daemon.url
      : undefined;
  } catch {
    return undefined;
  }
}

function isLoopbackTarget(target: string): boolean {
  try {
    const { hostname } = new URL(target);
    return (
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL(".", import.meta.url).pathname, "");
  const home = nerveHome(env);
  const nerveApiTarget =
    env.NERVE_API_TARGET ?? readDaemonUrl(home) ?? "http://127.0.0.1:3747";
  const localToken = isLoopbackTarget(nerveApiTarget)
    ? readText(path.join(home, "auth", "local-token"))
    : undefined;
  const authHeaders = localToken
    ? { authorization: `Bearer ${localToken}` }
    : undefined;

  return {
    plugins: [svelte(), tailwindcss()],
    resolve: {
      alias: {
        $lib: path.resolve("./src/lib"),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: nerveApiTarget,
          headers: authHeaders,
        },
        "/ws": {
          target: nerveApiTarget.replace(/^http/, "ws"),
          headers: authHeaders,
          ws: true,
        },
      },
    },
  };
});
