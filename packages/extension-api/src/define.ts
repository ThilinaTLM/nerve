/* eslint-disable @typescript-eslint/no-explicit-any -- method tables hold methods of different session and input types */
import type {
  ExtensionDefinition,
  MethodDefinition,
  NamespaceDefinition,
  ToolDefinition,
} from "./types.js";

/** Declares an extension. Returns the definition unchanged; the host reads it. */
export function defineExtension(
  definition: ExtensionDefinition,
): ExtensionDefinition {
  return definition;
}

/** Declares a namespace; `Session` is what `session(ctx)` returns and methods receive. */
export function defineNamespace<Session = undefined>(
  definition: NamespaceDefinition<Session>,
): NamespaceDefinition<Session> {
  return definition;
}

/** Declares a namespace method; the input type flows from `parse` into `authorize` and `run`. */
export function method<Input, Output = unknown, Session = any>(
  definition: MethodDefinition<Session, Input, Output>,
): MethodDefinition<Session, Input, Output> {
  return definition;
}

/** Declares a direct tool, bound to a namespace method (`method`) or with its own `parse`/`authorize`/`run`. */
export function defineTool<const T extends ToolDefinition>(definition: T): T {
  return definition;
}
