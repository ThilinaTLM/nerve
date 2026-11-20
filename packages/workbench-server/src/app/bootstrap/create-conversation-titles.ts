import { ConversationTitleService } from "../../domains/conversation-titles/title.service.js";
import type { createModelPort } from "../../core-host/model.adapter.js";
import type { RuntimeDeps } from "./create-runtime-services.js";

/** The title service, cancelling queued work when the user switches titles off. */
export function createConversationTitles(
  deps: Pick<RuntimeDeps, "storage" | "logger" | "events">,
  models: Pick<ReturnType<typeof createModelPort>, "resolve">,
): ConversationTitleService {
  const conversationTitles = new ConversationTitleService({
    settings: () => deps.storage.settings.conversationTitles,
    resolve: (selection) => models.resolve(selection),
    log: (context) => {
      // Failures are warnings so they surface at the default log level.
      const level = context.category === "ready" ? "info" : "warn";
      void deps.logger[level]("Conversation title generation", {
        context,
      }).catch(() => undefined);
    },
  });
  deps.events.subscribeNotify((event) => {
    if (
      event.type === "settings.updated" &&
      !deps.storage.settings.conversationTitles.enabled
    )
      conversationTitles.cancelQueued();
  });
  return conversationTitles;
}
