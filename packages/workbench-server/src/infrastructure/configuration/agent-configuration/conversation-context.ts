import type { AgentConfigurationServiceOptions } from "./agent-configuration-service.js";
import type { ConversationAgentContext } from "@nervekit/contracts/agent-configuration";
import { conversationConfigSchema } from "@nervekit/contracts/core";
import {
  ScopeUnavailableError,
  type ScopedDocumentStore,
} from "../scoped-store/scoped-document-store.js";
import type { AgentScope, AgentDocument } from "./document-adapters.js";

type Store = ScopedDocumentStore<AgentScope, AgentDocument>;
const scopeOf = (id: string) => ({
  scope: "conversation" as const,
  conversationId: id,
});

/** Only validated own JSON is exposed; never project/profile dependencies or retained fallback. */
export function readConversationContext(store: Store, id: string) {
  const state = store.peek(scopeOf(id));
  if (
    !state ||
    state.status === "unavailable" ||
    !("appliedProfile" in state.value.document)
  )
    return undefined;
  return {
    instructions: state.value.document.context?.instructions ?? null,
    systemPrompt: state.value.document.context?.systemPrompt ?? null,
  };
}
export async function loadConversationContext(store: Store, id: string) {
  await store.ensureLoaded(scopeOf(id));
  return readConversationContext(store, id);
}

/** Dedicated context edit, not a merge-layer mutation or an implicit repair. */
export async function saveConversationContext(
  store: Store,
  id: string,
  input: unknown,
  options: Pick<AgentConfigurationServiceOptions, "transitionReconciled">,
): Promise<void> {
  const patch = conversationConfigSchema
    .pick({ instructions: true, systemPrompt: true })
    .partial()
    .strict()
    .parse(input);
  const scope = scopeOf(id);
  const state = await store.ensureLoaded(scope);
  if (state.status === "unavailable") throw new ScopeUnavailableError();
  await store.save(scope, state.value, (document) => {
    if (!("appliedProfile" in document)) throw new ScopeUnavailableError();
    if (
      document.lastTransition &&
      !options.transitionReconciled?.(id, document.lastTransition)
    )
      throw new Error(
        "Committed transition must be reconciled before mutation",
      );
    const context: ConversationAgentContext = { ...document.context };
    for (const key of ["instructions", "systemPrompt"] as const) {
      if (patch[key] === null) delete context[key];
      else if (patch[key] !== undefined) context[key] = patch[key];
    }
    const candidate = { ...document };
    if (Object.keys(context).length) candidate.context = context;
    else delete candidate.context;
    return candidate;
  });
}
