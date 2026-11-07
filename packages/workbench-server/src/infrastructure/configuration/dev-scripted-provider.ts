import { registerDevScriptedBenchProvider } from "@nervekit/harness/models";

/**
 * The scripted bench model is a development tool for `pnpm desktop:dev`. It
 * needs the explicit opt-in AND the dev launcher's slot marker, which only
 * `packages/desktop-shell/scripts/dev-desktop.ts` sets (packaged desktop
 * builds clear both variables at startup).
 */
export function devScriptedProviderEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NERVE_DEV_SCRIPTED_PROVIDER === "1" &&
    /^\d+$/.test(env.NERVE_DESKTOP_DEV_SLOT ?? "")
  );
}

export function registerDevScriptedProviderIfEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!devScriptedProviderEnabled(env)) return false;
  registerDevScriptedBenchProvider();
  return true;
}
