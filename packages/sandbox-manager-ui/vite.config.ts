import path from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL(".", import.meta.url).pathname, "");
  const managerApiTarget =
    env.NERVE_SANDBOX_MANAGER_API_TARGET ?? "http://127.0.0.1:7869";

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
        },
      },
    },
  };
});
