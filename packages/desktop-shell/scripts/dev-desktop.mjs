import { spawn } from "node:child_process";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const home = join(repo, "data", "storage-1");
const profile = join(repo, "data", "desktop-profile-1");
const httpPort = 43967;
const httpsPort = 43968;
const env = {
  ...process.env,
  NERVE_HOME: home,
  NERVE_ELECTRON_USER_DATA: profile,
  NERVE_HOST: "127.0.0.1",
  NERVE_PORT: String(httpPort),
  NERVE_HTTPS_PORT: String(httpsPort),
  NERVE_ALLOW_REMOTE: "0",
  NERVE_MOBILE_HTTPS: "1",
};
// Use this home's credentials and the freshly built renderer, never ambient
// remote credentials or a renderer override from another development session.
delete env.NERVE_DAEMON_TOKEN;
delete env.NERVE_WEB_DIST;
delete env.ELECTRON_RUN_AS_NODE;

try {
  if (process.argv.slice(2).some((arg) => arg !== "--")) {
    throw new Error(
      "desktop:dev uses fixed local paths and ports; no arguments are supported.",
    );
  }
  await mkdir(home, { recursive: true });
  await mkdir(profile, { recursive: true });
  // Refuse redirected storage/profile directories rather than accidentally
  // opening a production home or sharing its Electron lock.
  const physicalRepo = await realpath(repo);
  if (
    (await realpath(home)) !== join(physicalRepo, "data", "storage-1") ||
    (await realpath(profile)) !== join(physicalRepo, "data", "desktop-profile-1")
  ) {
    throw new Error("desktop:dev data directories must not redirect through symlinks.");
  }

  await run("pnpm", ["-w", "build:native"]);
  await run("pnpm", ["-w", "build:workbench-runtime"]);
  await run("pnpm", ["--filter", "@nervekit/desktop-shell", "build"]);
  await preflight();
  console.log(`[nerve] development home: ${home}`);
  console.log(`[nerve] Electron profile: ${profile}`);
  console.log(`[nerve] HTTP ${httpPort}, mobile HTTPS ${httpsPort}`);
  await run(process.execPath, [
    fileURLToPath(new URL("start-electron.mjs", import.meta.url)),
    "--local",
    "--host",
    "127.0.0.1",
    "--port",
    String(httpPort),
    "--https-port",
    String(httpsPort),
    "--mobile-https",
  ]);
} catch (error) {
  console.error(`[nerve] ${error.message}`);
  process.exitCode = 1;
}

async function preflight() {
  // Use the desktop's own schema and authenticated discovery after its build.
  const { daemonFileSchema } = await import("@nervekit/contracts/status");
  const { findHealthyDaemon } = await import(
    "../dist/daemon/adapters/daemon-discovery.js"
  );
  const daemonPath = join(home, "daemon.json");
  let raw;
  try {
    raw = await readFile(daemonPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(
        "Cannot read the development home's daemon.json; refusing to launch.",
      );
    }
  }
  if (raw !== undefined) {
    let daemon;
    try {
      daemon = daemonFileSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error(
        "Invalid development daemon.json; refusing to launch. Inspect it manually.",
      );
    }
    const url = new URL(daemon.url);
    if (
      !daemon.dataDir ||
      resolve(daemon.dataDir) !== home ||
      (await realpath(daemon.dataDir)) !== (await realpath(home)) ||
      daemon.host !== "127.0.0.1" ||
      daemon.port !== httpPort ||
      url.origin !== `http://127.0.0.1:${httpPort}` ||
      daemon.mobileHttps?.port !== httpsPort
    ) {
      throw new Error(
        "Development daemon.json does not match this home and ports. Stop its owner and inspect the record manually; no process was stopped.",
      );
    }
    const existing = await findHealthyDaemon({
      home,
      daemonPath,
      localTokenPath: join(home, "secrets", "daemon-token"),
    });
    if (existing) {
      console.log(
        "[nerve] Reusing the authenticated daemon recorded in the development home (not owned by this launch).",
      );
      return;
    }
  }
  // Never choose another port or adopt an arbitrary listener. These temporary
  // exclusive binds only probe availability; the daemon still handles races.
  await assertPortFree(httpPort);
  await assertPortFree(httpsPort);
}

async function assertPortFree(port) {
  for (const host of ["0.0.0.0", "::"]) {
    await new Promise((resolvePromise, reject) => {
      const server = createServer();
      server.once("error", (error) => {
        if (
          host === "::" &&
          ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)
        ) {
          resolvePromise();
          return;
        }
        reject(
          new Error(
            `Development port ${port} is unavailable (${error.code}); refusing to reuse it or stop its owner.`,
          ),
        );
      });
      server.listen(
        { host, port, exclusive: true, ipv6Only: host === "::" },
        () => {
          server.close((error) => (error ? reject(error) : resolvePromise()));
        },
      );
    });
  }
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repo, env, stdio: "inherit" });
    // Signal only the child we launched, never a discovered daemon or a process
    // group that could contain another desktop. Electron owns daemon cleanup.
    const onInterrupt = () => child.kill("SIGINT");
    const onTerminate = () => child.kill("SIGTERM");
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);
    const cleanup = () => {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (code === 0) resolvePromise();
      else {
        reject(
          new Error(
            `${command} ${signal ? `stopped by ${signal}` : `exited with code ${code}`}.`,
          ),
        );
      }
    });
  });
}
