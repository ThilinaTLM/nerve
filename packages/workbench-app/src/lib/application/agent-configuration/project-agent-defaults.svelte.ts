import { onEvent } from "$lib/application/events/workbench-event-bus";
import {
  requestConversation,
  observeConversationChannel,
} from "$lib/application/startup/conversation-connection";
import { ProjectAgentDefaultsReadModel } from "./project-agent-defaults.js";

export const projectAgentDefaults = new ProjectAgentDefaultsReadModel(
  (projectId) =>
    requestConversation("agentConfiguration.resolveProject", { projectId }),
);

export function observeProjectAgentDefaults(): () => void {
  const stopResources = (
    [
      "agentProfiles.changed",
      "settings.updated",
      "providers.catalog_changed",
      "auth.providers_changed",
    ] as const
  ).map((type) =>
    onEvent(type, () => {
      void projectAgentDefaults.refresh();
    }),
  );
  const stopChannel = observeConversationChannel({
    recover: () => projectAgentDefaults.refresh(),
    disconnected() {},
    event() {},
    notice: (notice) => {
      if (
        notice.type === "agentConfiguration.changed" ||
        notice.type === "conversationDefaults.changed"
      ) {
        const scope = notice.data.scope;
        if (scope.scope === "user") void projectAgentDefaults.refresh();
        else if (scope.scope === "project")
          void projectAgentDefaults.refresh(scope.projectId);
      }
    },
  });
  return () => {
    for (const stop of stopResources) stop();
    stopChannel();
  };
}
