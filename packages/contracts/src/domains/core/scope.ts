import { z } from "zod";

/** Where a setting, account or MCP/channel definition is stored. */
export const layerSchema = z.enum(["user", "project"]);
export type Layer = z.infer<typeof layerSchema>;

/** Where a configuration resource comes from. `builtin` ships with Nerve. */
export const sourceSchema = z.enum(["builtin", "user", "project"]);
export type Source = z.infer<typeof sourceSchema>;

/** Scopes that can hold a value for one conversation. */
export const conversationScopeSchema = z.enum([
  "user",
  "project",
  "conversation",
]);
export type ConversationScope = z.infer<typeof conversationScopeSchema>;
