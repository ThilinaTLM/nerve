import { Type } from "typebox";
import type { ToolDefinition } from "../types.js";

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
    parameters: askUserParameters,
    executionMode: "sequential",
  },
  {
    name: "todos_set",
    group: "todos",
    baseRisk: "interaction",
    traits: [],
    executionKind: "host",
    label: "Set Todos",
    description: "Set or replace the todo list for the current task.",
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
    parameters: todosGetParameters,
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
