import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
} from "../method-handler-registry.js";
import type { UnifiedCompletionService } from "../../../domains/completions/unified-completion-service.js";

export type CompletionMethodContext = {
  completions: Pick<UnifiedCompletionService, "search" | "select">;
};
const defineCompletionMethodHandlers =
  defineWorkbenchMethodHandlersFor<CompletionMethodContext>();
export const completionMethodHandlers: WorkbenchMethodHandlerMapFor<CompletionMethodContext> =
  defineCompletionMethodHandlers({
    "completion.search": (state, params) => state.completions.search(params),
    "completion.select": (state, params) => state.completions.select(params),
  });
