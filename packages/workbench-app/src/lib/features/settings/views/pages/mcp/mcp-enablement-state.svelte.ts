import type { McpServerRow } from "@nervekit/contracts/mcp";
import { LayeredAgentState } from "$lib/application/agent-configuration/layered-agent-state.svelte";
import type { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import type { SettingsLayer } from "$lib/presentation/settings";
import { applyLayerChange } from "../../shared/layer-change";
import { mcpEnabledPointer, mcpEnablementLayers } from "./mcp-enablement";

/**
 * The layered Enabled switches of MCP servers, shared by the list and a
 * server's page: the user's agent settings and, with a project open, the
 * project's. The owner calls `connect` during initialisation.
 */
export class McpEnablementState extends LayeredAgentState {
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
