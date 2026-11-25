import type { McpServerRow } from "@nervekit/contracts/mcp";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import type { SettingsLayer } from "$lib/presentation/settings";
import { applyLayerChange } from "../../shared/layer-change";
import { mcpEnabledPointer, mcpEnablementLayers } from "./mcp-enablement";

/**
 * The layered Enabled switches of MCP servers, shared by the list and a
 * server's page: the user's agent settings and, with a project open, the
 * project's. The owner runs `load` and `observe` in effects.
 */
export class McpEnablementState {
  readonly user = new ScopedAgentState();
  readonly project = new ScopedAgentState();
  #projectId: string | undefined;

  constructor(private readonly context: () => { projectId?: string }) {}

  /** A project is open: there is a project column. */
  get layered(): boolean {
    return !!this.context().projectId;
  }

  load(): void {
    void this.user.load({ scope: "user" });
    const { projectId } = this.context();
    this.#projectId = projectId;
    if (projectId) void this.project.load({ scope: "project", projectId });
  }

  observe(): () => void {
    const stops = [this.user.observe(), this.project.observe()];
    return () => {
      for (const stop of stops) stop();
    };
  }

  reload(): Promise<unknown> {
    return Promise.all([
      this.user.reload(),
      this.#projectId ? this.project.reload() : undefined,
    ]);
  }

  get ready(): boolean {
    return (
      !!this.user.resolution && (!this.layered || !!this.project.resolution)
    );
  }

  get error(): string | undefined {
    return this.user.error ?? (this.layered ? this.project.error : undefined);
  }

  /** The project's settings file is not trusted: its column is locked. */
  get locked(): boolean {
    return (
      this.layered &&
      this.project.document?.status === "available" &&
      (this.project.document.trustState ?? "trusted") !== "trusted"
    );
  }

  layers(row: McpServerRow) {
    return mcpEnablementLayers({
      entry: row.entry,
      name: row.name,
      user: this.user.overrides,
      project: this.layered ? this.project.overrides : undefined,
      projectOwned: row.scope === "project",
    });
  }

  async change(row: McpServerRow, layer: SettingsLayer, next: boolean) {
    const write = async (
      editor: ScopedAgentState,
      choice: boolean | undefined,
    ) => {
      if (choice === undefined)
        await editor.save({}, [mcpEnabledPointer(row.name)]);
      else
        await editor.save({ mcpServers: { servers: { [row.name]: choice } } });
    };
    await applyLayerChange({
      value: this.layers(row).value,
      layer,
      next,
      writeUser: (choice) => write(this.user, choice),
      writeProject: (choice) => write(this.project, choice),
    });
  }
}
