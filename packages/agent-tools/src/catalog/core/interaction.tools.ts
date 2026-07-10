import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const askUserParameters = Type.Object(
  {
    question: Type.String({
      description: "The single focused free-text question to ask the user",
    }),
    context: Type.Optional(
      Type.String({
        description: "Optional brief background that helps the user answer",
      }),
    ),
    recommendation: Type.Optional(
      Type.String({
        description: "Optional current leaning or recommendation and why",
      }),
    ),
    placeholder: Type.Optional(
      Type.String({
        description: "Optional placeholder text for the reply input",
      }),
    ),
  },
  { additionalProperties: false },
);

const todoItemParameters = Type.Object(
  {
    todo: Type.String({ description: "The todo item text" }),
    done: Type.Boolean({ description: "Whether the item is done" }),
  },
  { additionalProperties: false },
);

const todosSetParameters = Type.Object(
  {
    todos: Type.Array(todoItemParameters, {
      description: "List of todo items with completion status",
    }),
  },
  { additionalProperties: false },
);

const todosGetParameters = Type.Object({}, { additionalProperties: false });

export const interactionToolDefinitions = [
  {
    name: "ask_user",
    group: "input",
    baseRisk: "interaction",
    traits: ["suspending"],
    executionKind: "host",
    label: "Ask User",
    description:
      "Ask one focused free-text question when progress depends on the user's decision or unavailable context.",
    promptSnippet: "Ask the user a focused free-text clarification question",
    promptGuidelines: [
      "Ask the user only for decisions or context unavailable from the repo/tools.",
    ],
    parameters: askUserParameters,
    executionMode: "sequential",
  },
  {
    name: "todos_set",
    group: "todos",
    baseRisk: "interaction",
    traits: ["write_capable"],
    executionKind: "host",
    label: "Set Todos",
    description: "Set or replace the todo list for the current task.",
    promptSnippet:
      "Set the todo list for the current task, replacing any existing todos",
    parameters: todosSetParameters,
    executionMode: "sequential",
  },
  {
    name: "todos_get",
    group: "todos",
    baseRisk: "read",
    traits: [],
    executionKind: "host",
    label: "Get Todos",
    description: "Get the current todo list with completion status.",
    promptSnippet: "Get the current todo list with completion status",
    parameters: todosGetParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];
