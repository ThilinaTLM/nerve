export type SandboxManagerRoute = "/" | "/settings";

function routeFromPathname(pathname: string): SandboxManagerRoute {
  return pathname === "/settings" ? "/settings" : "/";
}

export class SandboxManagerRouteState {
  route = $state<SandboxManagerRoute>("/");

  constructor() {
    if (typeof window !== "undefined")
      this.route = routeFromPathname(window.location.pathname);
  }

  navigate(path: SandboxManagerRoute): void {
    if (typeof window === "undefined") {
      this.route = path;
      return;
    }
    if (window.location.pathname !== path)
      window.history.pushState({}, "", path);
    this.route = path;
  }

  syncFromLocation(): void {
    if (typeof window === "undefined") return;
    this.route = routeFromPathname(window.location.pathname);
  }

  listen(): () => void {
    if (typeof window === "undefined") return () => undefined;
    const onPopState = () => this.syncFromLocation();
    window.addEventListener("popstate", onPopState);
    this.syncFromLocation();
    return () => window.removeEventListener("popstate", onPopState);
  }
}
