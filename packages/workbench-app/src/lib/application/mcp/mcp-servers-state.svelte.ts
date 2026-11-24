import type { McpServerRow, McpTarget } from "@nervekit/contracts/mcp";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { listMcpServers } from "./mcp-api";

type FileStatus = { path: string; exists: boolean; problems: string[] };

const sameTarget = (a: McpTarget | undefined, b: McpTarget) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The MCP servers of one target as the daemon reports them. A project target
 * also lists the user's servers it inherits. Refreshes on `mcp.changed` for
 * the user scope and for its own project.
 */
export class McpServersState {
  rows = $state.raw<McpServerRow[]>([]);
  file = $state.raw<FileStatus>();
  error = $state<string>();
  loaded = $state(false);
  #target: McpTarget | undefined;
  #generation = 0;

  async load(target: McpTarget): Promise<void> {
    const generation = ++this.#generation;
    if (!sameTarget(this.#target, target)) {
      this.rows = [];
      this.file = undefined;
      this.loaded = false;
    }
    this.#target = target;
    try {
      const result = await listMcpServers(target);
      if (generation !== this.#generation) return;
      this.rows = result.servers;
      this.file = result.file;
      this.error = undefined;
      this.loaded = true;
    } catch (cause) {
      if (generation === this.#generation)
        this.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  reload(): Promise<void> {
    return this.#target ? this.load(this.#target) : Promise.resolve();
  }

  /** Keeps the list current; returns the unsubscribe. */
  observe(): () => void {
    return onEvent("mcp.changed", (event) => {
      const target = this.#target;
      const scope = event.data?.scope as McpTarget | undefined;
      if (!target || !scope) return;
      if (
        scope.scope === "user" ||
        (target.scope === "project" &&
          scope.scope === "project" &&
          scope.projectId === target.projectId)
      )
        void this.reload();
    });
  }
}
