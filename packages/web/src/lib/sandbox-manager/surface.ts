/**
 * Detects whether the current page should render the sandbox-manager surface
 * instead of the default Nerve workbench. This runs before any workbench
 * provider is mounted so the two surfaces never share bootstrap side effects.
 */
export const SANDBOX_MANAGER_BASE_PATH = "/sandbox-manager";

export function isSandboxManagerSurface(): boolean {
  if (typeof window === "undefined") return false;
  const { pathname, search } = window.location;
  if (
    pathname === SANDBOX_MANAGER_BASE_PATH ||
    pathname.startsWith(`${SANDBOX_MANAGER_BASE_PATH}/`)
  )
    return true;
  return new URLSearchParams(search).get("surface") === "sandbox-manager";
}
