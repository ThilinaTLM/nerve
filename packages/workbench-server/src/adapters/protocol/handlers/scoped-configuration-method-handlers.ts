import { createConfigurationReload } from "../../../core-host/configuration-reload.js";
import { readFile } from "node:fs/promises";
import {
  agentPreferencesSchema,
  profileDefinitionSchema,
  type ScopedTrustRequest,
  type ScopedConfigurationTarget,
} from "@nervekit/contracts/agent-configuration";
import { withFileMutation } from "../../../infrastructure/storage-bootstrap/file-mutations.js";
import {
  digestBytes,
  ScopeConflictError,
} from "../../../infrastructure/configuration/scoped-store/scoped-document-store.js";
import {
  configurationTargetPath,
  createScopedRepair,
} from "../../../infrastructure/configuration/agent-configuration/scoped-repair.js";
import { diagnostic } from "../../../infrastructure/configuration/agent-configuration/document-adapters.js";
import { mutationFailure } from "../../../infrastructure/configuration/agent-configuration/scoped-configuration-operations.js";
import { defineWorkbenchMethodHandlersFor } from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";

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
async function trust(state: Context, input: ScopedTrustRequest) {
  const service = state.agentConfiguration;
  const file = configurationTargetPath(service, input.target);
  try {
    await withFileMutation(file, async () => {
      const bytes = await readFile(file);
      if (digestBytes(bytes) !== input.expectedDigest)
        throw new ScopeConflictError();
      if (input.trusted) {
        const parsed: unknown = JSON.parse(bytes.toString("utf8"));
        if (input.target.document === "agent")
          agentPreferencesSchema.parse(parsed);
        else if (
          profileDefinitionSchema.parse(parsed).name !== input.target.name
        )
          throw new Error("Profile name differs from filename");
      }
      state.conversationCore.trust.decide({
        kind:
          input.target.document === "agent"
            ? "project_capabilities"
            : "agent_profile",
        projectId: input.target.scope.projectId,
        name:
          input.target.document === "agent"
            ? "Agent configuration"
            : input.target.name,
        path: file,
        contentDigest: input.expectedDigest,
        status: input.trusted ? "trusted" : "rejected",
      });
    });
    service.invalidateResources();
    state.admissionPolicy.invalidate();
    if (input.target.document === "agent")
      await service.reload(input.target.scope);
    else await service.profiles.reload(input.target.scope, input.target.name);
    await state.conversationCore.retryConfigurationBlocked();
    await state.conversationCore.reconcilePlanReviews();
    return {
      status: "saved" as const,
      digest: input.expectedDigest,
      trusted: input.trusted,
    };
  } catch (error) {
    return failure(state, input.target, error);
  }
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
  "agentProfiles.trust": trust,
  "agentConfiguration.trust": trust,
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
