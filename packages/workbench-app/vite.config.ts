import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { materialIconThemePlugin } from "./vite-material-icon-theme";

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
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
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
    plugins: [
      materialIconThemePlugin(),
      svelte(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        // Keep the service worker out of `pnpm dev` so it cannot shadow the
        // Vite `/api` + `/ws` proxy below.
        devOptions: { enabled: false },
        manifest: {
          name: "Nerve",
          short_name: "Nerve",
          description: "UI-first local AI coding harness",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          background_color: "#070a10",
          theme_color: "#070a10",
          icons: [
            {
              src: "/pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,webp,mp3,woff2,json}"],
          // The complete file-icon sprite is emitted locally but loaded on
          // demand rather than turning service-worker installation into a
          // multi-megabyte prerequisite.
          globIgnores: ["**/material-file-icons-*.svg"],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          // Serve the cached app shell for in-app navigations (fast + offline),
          // but never hijack the token->cookie auth redirect, the CA download,
          // the mobile setup page, or the dynamic API/WS endpoints.
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/ws\b/,
            /^\/mobile-setup\b/,
            /^\/nerve-local-ca\.pem$/,
            /[?&]token=/,
          ],
        },
      }),
    ],
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
          ws: true,
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
