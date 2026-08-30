import { Hono } from "hono";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";
type AgentArtifactRoutesContext =
  ServerAdapterContexts["http"]["agentArtifacts"];
import { buildAgentSystemPrompt } from "../../../domains/agents/execution/system-prompt-builder.js";
import { routeHandler } from "../responses.js";
import { routeParam } from "../route-params.js";

export function createAgentArtifactRoutes(
  state: AgentArtifactRoutesContext,
): Hono {
  const app = new Hono();
  app.get(
    "/agents/:agentId/system-prompt",
    routeHandler(async (c) => {
      const agentId = routeParam(c, "agentId");
      const agent = state.agentLifecycle.getAgent(agentId);
      const pythonAvailable = await state.pythonRuntime.isAvailableForProject(
        agent.projectDir,
      );
      const prompt = await buildAgentSystemPrompt(agent, {
        storageHome: state.storage.paths.home,
        pythonAvailable,
        disabledToolNames: state.storage.settings.tools.disabled,
        disabledSkillNames: state.storage.settings.skills.disabled,
        enabledAgentBrowserSkillNames:
          state.storage.settings.skills.agentBrowser.enabled,
        agentBrowserSkills: state.agentBrowserSkills.skills,
        jiraEnabled: state.storage.settings.tools.jira.enabled,
        confluenceEnabled: state.storage.settings.tools.confluence.enabled,
      });
      return c.body(prompt, 200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="system-prompt-${agentId}.md"`,
      });
    }),
  );
  return app;
}
