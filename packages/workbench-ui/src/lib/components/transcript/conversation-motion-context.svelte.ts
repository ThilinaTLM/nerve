import { getContext, setContext } from "svelte";
import type { ConversationMotionBudget } from "./conversation-motion-budget";

const CONVERSATION_MOTION_BUDGET = Symbol("conversation-motion-budget");

export function provideConversationMotionBudget(
  budget: ConversationMotionBudget,
): void {
  setContext(CONVERSATION_MOTION_BUDGET, budget);
}

export function getConversationMotionBudget():
  | ConversationMotionBudget
  | undefined {
  return getContext<ConversationMotionBudget | undefined>(
    CONVERSATION_MOTION_BUDGET,
  );
}
