import { untrack } from "svelte";
import { modelKey } from "$lib/presentation/utils/model";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import {
  ConversationAgentUsageController,
  type AgentUsageState,
} from "$lib/features/conversations/state/conversation-agent-usage";

export type ConversationUsageDependencies = {
  /** Conversation whose all-time usage is fetched. */
  conversationId: () => string | undefined;
  /** Fetch while the pane is active and connected. */
  enabled: () => boolean;
  responseCount: () => number;
  /** Window reported by the conversation context, if known. */
  contextWindow: () => number | undefined;
  selectedModelKey: () => string;
};

/** Usage details for one pane: all-time agent usage and the context window. */
export class ConversationUsage {
  readonly #deps: ConversationUsageDependencies;
  open = $state(false);
  agentState = $state<AgentUsageState>({ loading: false });
  readonly #controller: ConversationAgentUsageController;

  readonly contextWindow: number;

  constructor(deps: ConversationUsageDependencies) {
    this.#deps = deps;
    this.contextWindow = $derived(
      this.#deps.contextWindow() ??
        settingsState.models.find(
          (m) => modelKey(m) === this.#deps.selectedModelKey(),
        )?.contextWindow ??
        0,
    );
    this.#controller = new ConversationAgentUsageController({
      fetch: (conversationId) =>
        requestConversation("conversation.getUsage", { conversationId }),
      publish: (state) => {
        this.agentState = state;
      },
    });
    $effect(() => {
      // All-time usage also drives the badge's cache warning, so fetch it while the
      // conversation is active; poll only while the details are open.
      this.#controller.configure(
        deps.conversationId(),
        deps.enabled(),
        this.open,
      );
    });
    // Each new response changes recorded usage.
    $effect(() => {
      void deps.responseCount();
      untrack(() => this.#controller.invalidate());
    });
    $effect(() => () => this.#controller.dispose());
  }

  retry = (): void => {
    this.#controller.retry();
  };
}
