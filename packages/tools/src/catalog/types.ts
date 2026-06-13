import type { ToolName } from "@nerve/shared";
import type { Static, TSchema } from "typebox";

export type CoreToolExecutionMode = "sequential" | "parallel";

export interface CoreToolDefinition<TParams extends TSchema = TSchema> {
  name: ToolName;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;
  prepareArguments?: (args: unknown) => Static<TParams>;
  executionMode?: CoreToolExecutionMode;
}
