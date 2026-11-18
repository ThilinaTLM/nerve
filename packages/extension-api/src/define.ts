/* eslint-disable @typescript-eslint/no-explicit-any -- method tables hold methods of different session and input types */
import type {
  ExtensionDefinition,
  MethodDefinition,
  NamespaceDefinition,
  ToolDefinition,
} from "./definition.js";

/**
 * Declares an extension: `export default defineExtension({...})` in `src/extension.ts`. Returns
 * the definition unchanged (it only checks the types); `nerve-ext build` and the host read it.
 */
export function defineExtension(
  definition: ExtensionDefinition,
): ExtensionDefinition {
  return definition;
}

/**
 * Declares a `quick_script` namespace. `Session` is what `session(ctx)` returns and every method's
 * `run` receives as its first argument; leave it out when the namespace has no `session`.
 * Returns the definition unchanged.
 */
export function defineNamespace<Session = undefined>(
  definition: NamespaceDefinition<Session>,
): NamespaceDefinition<Session> {
  return definition;
}

/**
 * Declares a namespace method; the input type flows from `parse` into `authorize` and `run`.
 * `Input` is what `parse` returns, `Output` what `run` returns. Returns the definition unchanged.
 */
export function method<Input, Output = unknown, Session = any>(
  definition: MethodDefinition<Session, Input, Output>,
): MethodDefinition<Session, Input, Output> {
  return definition;
}

/**
 * Declares a direct tool the model calls by name: bound to a namespace method (`method`: `"<namespace>.<method>"`)
 * or with its own `risk`, `parse`, `authorize` and `run`. Returns the definition unchanged.
 */
export function defineTool<const T extends ToolDefinition>(definition: T): T {
  return definition;
}
