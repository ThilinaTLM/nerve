import type { ToolRisk } from "@nervekit/contracts/permissions";
import type { CompletionItem } from "@nervekit/contracts/completions";
export const conversationCatalog = $state({
  slashCompletions: [] as CompletionItem[],
  toolRisks: {} as Record<string, ToolRisk>,
});
