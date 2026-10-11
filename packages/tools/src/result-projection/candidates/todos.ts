import type {
  CandidateContext,
  ProjectionCandidate,
  SemanticItem,
} from "../types.js";
import { mutationCandidate } from "./mutation.js";
import { artifacts } from "../candidate-artifacts.js";
import { count, textOf, record, array, string } from "../candidate-values.js";
export function lifecycleCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const todos = array(result.todos) ?? array(details.todos);
  if (todos) {
    const items: SemanticItem[] = todos.map((value, index) => ({
      id: String(index),
      countsAs: "item",
      blocks: [
        {
          type: "text",
          text: `${index + 1}. ${record(value).done === true ? "[x]" : "[ ]"} ${string(record(value).todo)}`,
        },
      ],
    }));
    const title = `Todos: ${items.length}`;
    return {
      blocks: [
        {
          type: "text",
          text: [title, ...items.map((item) => textOf(item.blocks))].join("\n"),
        },
      ],
      status: [{ type: "text", text: title }],
      items,
      overflow: { noun: "todo" },
      counts: [count("item", items.length, items.length)],
      artifacts: artifacts(context),
    };
  }

  return mutationCandidate(context);
}
