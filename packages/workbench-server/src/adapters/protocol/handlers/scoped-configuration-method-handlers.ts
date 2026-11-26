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
  "agentProfiles.read": async (state, input) => {
    try {
      return {
        status: "available" as const,
        ...(await state.agentConfiguration.profiles.readForEditing(
          input.scope,
          input.name,
          input.role,
        )),
      };
    } catch (error) {
      return failure(
        state,
        { document: "profile", scope: input.scope, name: input.name },
        error,
      );
    }
  },
  "agentProfiles.save": async (state, input) => {
    try {
      const saved = await state.agentConfiguration.profiles.save(
        input.scope,
        input.name,
        input.expectedDigest,
        input.definition,
      );
      return { status: "saved" as const, digest: saved.digest };
    } catch (error) {
      return failure(
        state,
        { document: "profile", scope: input.scope, name: input.name },
        error,
      );
    }
  },
  "agentProfiles.delete": async (state, input) => {
    try {
      return await state.agentConfiguration.profiles.deleteLocal(
        input.scope,
        input.name,
        input.expectedDigest,
      );
    } catch (error) {
      return failure(
        state,
        { document: "profile", scope: input.scope, name: input.name },
        error,
      );
    }
  },
  "agentProfiles.reset": async (state, input) => {
    try {
      return await state.agentConfiguration.profiles.deleteLocal(
        input.scope,
        input.name,
        input.expectedDigest,
      );
    } catch (error) {
      return failure(
        state,
        { document: "profile", scope: input.scope, name: input.name },
        error,
      );
    }
  },
  "agentConfiguration.repairPreview": async (state, input) => {
    try {
      return {
        status: "ready" as const,
        preview: await createScopedRepair(state.agentConfiguration).preview(
          input,
        ),
      };
    } catch (error) {
      return failure(state, input.target, error);
    }
  },
  "agentConfiguration.repairApply": async (state, input) => {
    try {
      return await createScopedRepair(state.agentConfiguration).apply(input);
    } catch (error) {
      return failure(state, input.target, error);
    }
  },
});
