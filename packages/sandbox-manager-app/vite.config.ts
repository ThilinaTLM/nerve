import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
  const managerEnv = loadEnv(
    mode,
    fileURLToPath(new URL("../sandbox-manager/", import.meta.url)),
    "",
  );
  const managerApiTarget =
    env.NERVE_SANDBOX_MANAGER_API_TARGET ??
    managerEnv.NERVE_SANDBOX_MANAGER_API_TARGET ??
    "http://127.0.0.1:7869";
  const managerApiKey =
    env.NERVE_SANDBOX_MANAGER_API_KEY ??
    managerEnv.NERVE_SANDBOX_MANAGER_API_KEY;

  return {
    base: "/",
    plugins: [svelte(), tailwindcss()],
    resolve: {
      alias: {
        $lib: path.resolve("./src/lib"),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5174,
      proxy: {
        "/api": {
          target: managerApiTarget,
          ws: true,
          headers: managerApiKey ? { "x-api-key": managerApiKey } : undefined,
        },
      },
    },
  };
});
