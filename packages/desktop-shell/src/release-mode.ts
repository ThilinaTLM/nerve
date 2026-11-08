/**
 * Release-mode signal. The published launcher (`bin.ts`, i.e. `npx @nervekit/desktop`)
 * sets this variable on the Electron process it spawns. Repo entrypoints
 * (`pnpm desktop:dev`, `pnpm desktop:prod`, `scripts/start-electron.ts`) never set it
 * and therefore stay in development mode. `app.isPackaged` cannot be used: Electron
 * is always launched as `electron <package dir>`, so it is always false.
 */
export const RELEASE_MODE_ENV = "NERVE_DESKTOP_RELEASE";

/** Reads the marker and removes it so it never reaches the daemon or other children. */
export function consumeReleaseMode(env: NodeJS.ProcessEnv): boolean {
  const release = env[RELEASE_MODE_ENV] === "1";
  delete env[RELEASE_MODE_ENV];
  return release;
}

/** Evaluated once, at first import, before any child process is spawned. */
export const isReleaseMode = consumeReleaseMode(process.env);
