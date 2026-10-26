import { normalizeCreationPreferencesOverrides } from "@nervekit/contracts/agent-configuration";
import { prepareCreationMutation } from "./agent-document-transactions.js";
import type { ScopedDocumentStore } from "../scoped-store/scoped-document-store.js";
import {
  freezeJson,
  ScopeUnavailableError,
  type ScopeHealth,
} from "../scoped-store/scoped-document-store.js";
import {
  healthDiagnostics,
  type PreferenceScope,
  type CreationPreferences,
} from "./document-adapters.js";

const builtinCreationPreferences = {
  defaultAgentProfile: "coding",
  scopedModels: [],
} satisfies CreationPreferences["overrides"];

export async function readCreationPreferences(
  load: (
    scope: PreferenceScope,
  ) => Promise<ScopeHealth<PreferenceScope, CreationPreferences>>,
  projectId?: string,
) {
  const scopes: PreferenceScope[] = projectId
    ? [{ scope: "user" }, { scope: "project", projectId }]
    : [{ scope: "user" }];
  const [user, project] = await Promise.all(scopes.map(load));
  const diagnostics = [user, ...(project ? [project] : [])].flatMap((state) =>
    healthDiagnostics(state, "conversation-defaults"),
  );
  if (user.status === "unavailable" || project?.status === "unavailable")
    return { status: "unavailable" as const, diagnostics };
  return freezeJson({
    status: "available" as const,
    overrides: {
      ...builtinCreationPreferences,
      ...user.value.document.overrides,
      ...project?.value.document.overrides,
    },
    diagnostics,
  });
}

export async function readInheritedCreationPreferences(
  store: ScopedDocumentStore<PreferenceScope, CreationPreferences>,
  load: (scope: PreferenceScope) => Promise<unknown>,
  scope: PreferenceScope,
): Promise<CreationPreferences["overrides"]> {
  if (scope.scope === "project") await load({ scope: "user" });
  const user =
    scope.scope === "project" ? store.peek({ scope: "user" }) : undefined;
  if (scope.scope === "project" && (!user || user.status === "unavailable"))
    throw new ScopeUnavailableError();
  return {
    ...builtinCreationPreferences,
    ...(user && user.status !== "unavailable"
      ? user.value.document.overrides
      : {}),
  };
}

export type CreationMutation = {
  expectedRevision: number;
  expectedDigest: string;
  changes: CreationPreferences["overrides"];
  resets: string[];
};
export async function saveCreationPreferences(
  store: ScopedDocumentStore<PreferenceScope, CreationPreferences>,
  load: (scope: PreferenceScope) => Promise<unknown>,
  scope: PreferenceScope,
  mutation: CreationMutation,
) {
  const { expected, changes, keys } = prepareCreationMutation(mutation);
  await load(scope);
  return store.save(
    scope,
    { revision: expected.expectedRevision, digest: expected.expectedDigest },
    async (document) => {
      const inherited = await readInheritedCreationPreferences(
        store,
        load,
        scope,
      );
      const overrides = { ...document.overrides, ...changes };
      for (const key of keys) delete overrides[key];
      return {
        ...document,
        overrides: normalizeCreationPreferencesOverrides(overrides, inherited),
      };
    },
  );
}
