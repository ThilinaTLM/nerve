export type SandboxManagerRouteKind = "fleet" | "sandbox" | "chat" | "settings";

export type ParsedRoute = {
  kind: SandboxManagerRouteKind;
  sandboxId?: string;
  settingsSection?: string;
};

function parse(pathname: string): ParsedRoute {
  const segments = pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (segments[0] === "settings")
    return { kind: "settings", settingsSection: segments[1] };
  if (segments[0] === "sandboxes" && segments[1]) {
    const sandboxId = decodeURIComponent(segments[1]);
    if (segments[2] === "chat") return { kind: "chat", sandboxId };
    return { kind: "sandbox", sandboxId };
  }
  return { kind: "fleet" };
}

export class SandboxManagerRouteState {
  current = $state<ParsedRoute>({ kind: "fleet" });

  constructor() {
    if (typeof window !== "undefined")
      this.current = parse(window.location.pathname);
  }

  get kind(): SandboxManagerRouteKind {
    return this.current.kind;
  }

  get sandboxId(): string | undefined {
    return this.current.sandboxId;
  }

  get settingsSection(): string | undefined {
    return this.current.settingsSection;
  }

  navigate(path: string): void {
    if (typeof window === "undefined") {
      this.current = parse(path);
      return;
    }
    if (window.location.pathname !== path)
      window.history.pushState({}, "", path);
    this.current = parse(path);
  }

  fleet(): void {
    this.navigate("/");
  }

  openSandbox(sandboxId: string): void {
    this.navigate(`/sandboxes/${encodeURIComponent(sandboxId)}`);
  }

  openChat(sandboxId: string): void {
    this.navigate(`/sandboxes/${encodeURIComponent(sandboxId)}/chat`);
  }

  openSettings(section?: string): void {
    this.navigate(section ? `/settings/${section}` : "/settings");
  }

  syncFromLocation(): void {
    if (typeof window === "undefined") return;
    this.current = parse(window.location.pathname);
  }

  listen(): () => void {
    if (typeof window === "undefined") return () => undefined;
    const onPopState = () => this.syncFromLocation();
    window.addEventListener("popstate", onPopState);
    this.syncFromLocation();
    return () => window.removeEventListener("popstate", onPopState);
  }
}
