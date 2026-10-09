import { isWorkbenchEvent } from "@nervekit/contracts/events";
import type { NotifyEvent } from "@nervekit/contracts/events";
import type { ProtocolV1Message } from "@nervekit/contracts/wire";

/** Project notices follow this socket's filesystem/repository monitor demand. */
export class WorkbenchConnection {
  readonly #projects = new Set<string>();
  readonly #repositories = new Set<string>();

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
    if (typeof input.repo === "string") {
      const key = `${input.projectId}\0${input.repo}`;
      if (method === "git.repository.monitor.sync") this.#repositories.add(key);
      if (method === "git.repository.monitor.clear")
        this.#repositories.delete(key);
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
    if (event.type.startsWith("git.repository.")) {
      return (
        this.#repositories.has(`${data.projectId}\0${data.repo}`) ||
        (data.projectId === undefined &&
          [...this.#repositories].some((key) => key.endsWith(`\0${data.repo}`)))
      );
    }
    return true;
  }
}
