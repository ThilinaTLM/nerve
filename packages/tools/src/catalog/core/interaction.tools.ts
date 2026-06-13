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
    label: "Ask User",
    description:
      "Ask the user one focused free-text question and wait for their reply. Use only when the answer depends on the user's intent, preference, decision, or unavailable context.",
    promptSnippet: "Ask the user a focused free-text clarification question",
    promptGuidelines: [
      "Use ask_user only when the answer must come from the user rather than the codebase, tools, or prior context.",
      "Ask one focused question at a time. Include brief context and a recommendation when it helps the user answer.",
      "Do not use ask_user for questions you can answer by inspecting files, running tools, or reasoning from existing conversation context.",
    ],
    parameters: askUserParameters,
    executionMode: "sequential",
  },
  {
    name: "todos_set",
    label: "Set Todos",
    description:
      "Set the todo list for the current task. Replaces any existing todos. Use this at the start of a complex task to outline the steps.",
    promptSnippet:
      "Set the todo list for the current task, replacing any existing todos",
    parameters: todosSetParameters,
    executionMode: "sequential",
  },
  {
    name: "todos_get",
    label: "Get Todos",
    description: "Get the current todo list with completion status.",
    promptSnippet: "Get the current todo list with completion status",
    parameters: todosGetParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];
