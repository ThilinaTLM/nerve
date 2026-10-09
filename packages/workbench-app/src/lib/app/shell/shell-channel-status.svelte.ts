import {
  isConversationChannelReady,
  onConversationChannelReadyChange,
} from "$lib/application/startup/conversation-connection";
import {
  isWorkbenchReady,
  onWorkbenchChannelReadyChange,
} from "$lib/application/startup/workbench-connection";

/** Connected only while both transport owners are ready. */
export class ShellChannelStatus {
  connected = $state(false);

  observe(): () => void {
    let conversationReady = isConversationChannelReady();
    let workbenchReady = isWorkbenchReady();
    const refresh = () => {
      this.connected = conversationReady && workbenchReady;
    };
    const unobserveConversation = onConversationChannelReadyChange((ready) => {
      conversationReady = ready;
      refresh();
    });
    const unobserveWorkbench = onWorkbenchChannelReadyChange((ready) => {
      workbenchReady = ready;
      refresh();
    });
    refresh();
    return () => {
      unobserveConversation();
      unobserveWorkbench();
    };
  }
}
