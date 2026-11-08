import { isWorkbenchEvent } from "@nervekit/contracts/events";
import type { NotifyEvent } from "@nervekit/contracts/events";
import type { ProtocolV1Message } from "@nervekit/contracts/wire";

/** Project notices follow this socket's filesystem monitor, PR and Git workspace demand. */
export class WorkbenchConnection {
  readonly #projects = new Set<string>();
  readonly #pullRequests = new Set<string>();
  readonly #workspaces = new Set<string>();

  receive(message: ProtocolV1Message): void {
    if (message.kind !== "request") return;
    const { method, params } = message.data;
    if (!params || typeof params !== "object") return;
    const input = params as Record<string, unknown>;
    if (typeof input.projectId !== "string") return;
    if (method === "filesystem.project.monitor.sync")
      this.#projects.add(input.projectId);
    if (method === "filesystem.project.monitor.clear")
      this.#projects.delete(input.projectId);
    if (method === "git.workspace.watch.sync") {
      // A sync that releases all demand is as good as a clear.
      if (
        input.visible === false &&
        !(Array.isArray(input.detail) && input.detail.length) &&
        !input.hint
      )
        this.#workspaces.delete(input.projectId);
      else this.#workspaces.add(input.projectId);
    }
    if (method === "git.workspace.watch.clear")
      this.#workspaces.delete(input.projectId);
    if (typeof input.repo === "string") {
      const key = `${input.projectId}\0${input.repo}`;
      if (method === "github.pr.watch.sync") this.#pullRequests.add(key);
      if (method === "github.pr.watch.clear") this.#pullRequests.delete(key);
    }
  }

  accepts(event: NotifyEvent): boolean {
    if (!isWorkbenchEvent(event.type)) return false;
    const data = event.data as Record<string, unknown>;
    if (event.type === "filesystem.project.changed") {
      return (
        typeof data.projectId === "string" && this.#projects.has(data.projectId)
      );
    }
    if (event.type === "git.workspace.changed")
      return (
        typeof data.projectId === "string" &&
        this.#workspaces.has(data.projectId)
      );
    if (event.type === "github.pr.changed")
      return this.#pullRequests.has(`${data.projectId}\0${data.repo}`);
    // Repository invalidations feed the server's workspace store only.
    if (event.type.startsWith("git.repository.")) return false;
    return true;
  }
}
