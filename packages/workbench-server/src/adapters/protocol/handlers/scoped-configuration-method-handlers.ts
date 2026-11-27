import { createConfigurationReload } from "../../../core-host/configuration/configuration-reload.js";
import type { ScopedConfigurationTarget } from "@nervekit/contracts/agent-configuration";
import {
  configurationTargetPath,
  createScopedRepair,
} from "../../../infrastructure/configuration/agent-configuration/scoped-repair.js";
import { diagnostic } from "../../../infrastructure/configuration/agent-configuration/document-adapters.js";
import { mutationFailure } from "../../../infrastructure/configuration/agent-configuration/scoped-configuration-operations.js";
import { defineWorkbenchMethodHandlersFor } from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../contexts.js";

type Context = ServerAdapterContexts["protocol"]["platform"];
const define = defineWorkbenchMethodHandlersFor<Context>();
function failure(
  state: Context,
  target: ScopedConfigurationTarget,
  error: unknown,
) {
  const result = mutationFailure(state.agentConfiguration, target.scope, error);
  if (result.status === "conflict")
    return { status: "conflict" as const, diagnostics: [] };
  const document =
    target.document === "profile" ? `profile:${target.name}` : target.document;
  return {
    status: result.status,
    diagnostics: [
      diagnostic(
        target.scope,
        document,
        configurationTargetPath(state.agentConfiguration, target),
        result.status === "unavailable"
          ? "configuration-unavailable"
          : "invalid-value",
      ),
    ],
  };
}
/** Runs `run`, mapping any thrown error to the scoped-configuration failure result. */
async function guarded<T>(
  state: Context,
  target: ScopedConfigurationTarget,
  run: () => Promise<T>,
) {
  try {
    return await run();
  } catch (error) {
    return failure(state, target, error);
  }
}
function profileTarget(input: {
  scope: Extract<ScopedConfigurationTarget, { document: "profile" }>["scope"];
  name: string;
}): ScopedConfigurationTarget {
  return { document: "profile", scope: input.scope, name: input.name };
}
const deleteLocalProfile = (
  state: Context,
  input: {
    scope: Extract<ScopedConfigurationTarget, { document: "profile" }>["scope"];
    name: string;
    expectedDigest: string;
  },
) =>
  guarded(state, profileTarget(input), () =>
    state.agentConfiguration.profiles.deleteLocal(
      input.scope,
      input.name,
      input.expectedDigest,
    ),
  );
export const scopedConfigurationMethodHandlers = define({
  "agentConfiguration.reload": async (state, input) => ({
    status: "reloaded" as const,
    diagnostics: await createConfigurationReload(
      state.agentConfiguration,
      state.admissionPolicy,
    ).target(input.target),
  }),
  "agentProfiles.list": (state, input) =>
    state.agentConfiguration.profiles.listForEditing(input.scope, input.role),
  "agentProfiles.read": (state, input) =>
    guarded(state, profileTarget(input), async () => ({
      status: "available" as const,
      ...(await state.agentConfiguration.profiles.readForEditing(
        input.scope,
        input.name,
        input.role,
      )),
    })),
  "agentProfiles.save": (state, input) =>
    guarded(state, profileTarget(input), async () => {
      const saved = await state.agentConfiguration.profiles.save(
        input.scope,
        input.name,
        input.expectedDigest,
        input.definition,
      );
      return { status: "saved" as const, digest: saved.digest };
    }),
  // Resetting a built-in override and deleting a local profile are the same operation.
  "agentProfiles.delete": deleteLocalProfile,
  "agentProfiles.reset": deleteLocalProfile,
  "agentConfiguration.repairPreview": (state, input) =>
    guarded(state, input.target, async () => ({
      status: "ready" as const,
      preview: await createScopedRepair(state.agentConfiguration).preview(
        input,
      ),
    })),
  "agentConfiguration.repairApply": (state, input) =>
    guarded(state, input.target, () =>
      createScopedRepair(state.agentConfiguration).apply(input),
    ),
});
