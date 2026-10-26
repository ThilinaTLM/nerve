import { Type } from "typebox";
import type { ToolDefinition } from "../../contracts.js";

const askUserParameters = Type.Object(
  {
    questions: Type.Array(
      Type.Object(
        {
          id: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 40,
              pattern: "^[a-z0-9_-]+$",
            }),
          ),
          question: Type.String(),
          context: Type.Optional(
            Type.String({
              description: "One short line of background needed to decide.",
            }),
          ),
          recommendation: Type.Optional(
            Type.String({
              description: "One short line: your recommendation and why.",
            }),
          ),
          options: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  label: Type.String({
                    minLength: 1,
                    maxLength: 200,
                  }),
                  description: Type.Optional(Type.String()),
                  recommended: Type.Optional(Type.Boolean()),
                },
                { additionalProperties: false },
              ),
              {
                maxItems: 6,
              },
            ),
          ),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 5 },
    ),
  },
  { additionalProperties: false },
);

const todoItemParameters = Type.Object(
  {
    todo: Type.String(),
    done: Type.Boolean(),
  },
  { additionalProperties: false },
);

const todosSetParameters = Type.Object(
  {
    todos: Type.Array(todoItemParameters, {}),
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
      "Ask focused questions when progress depends on the user's decision. Batch related questions (max 5). Offer options for clear choices and mark at most one recommended. Users can also answer in free text and attach images (returned as readable paths).",
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
    description: "Replace the task todo list.",
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
    description: "Get the task todo list.",
    parameters: todosGetParameters,
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
