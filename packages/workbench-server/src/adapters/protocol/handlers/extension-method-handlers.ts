import { readFile } from "node:fs/promises";
import type { ExtensionTarget } from "@nervekit/contracts/extensions";
import { withFileMutation } from "../../../infrastructure/storage-bootstrap/file-mutations.js";
import { digestBytes } from "../../../infrastructure/configuration/scoped-store/scoped-document-store.js";
import { toScopeRef } from "../../../core-host/extension-views.js";
import { defineWorkbenchMethodHandlersFor } from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../contexts.js";

type Context = ServerAdapterContexts["protocol"]["platform"];
const define = defineWorkbenchMethodHandlersFor<Context>();

async function lockedFor(state: Context, target: ExtensionTarget, id: string) {
  if (target.scope !== "conversation") return [];
  const context = await state.extensionViews.context(target);
  return state.extensionSettings.lockedFields(context.appliedProfile, id);
}

export const extensionMethodHandlers = define({
  "extensions.get": (state, { target }) => state.extensionViews.view(target),
  "extensions.save": async (state, input) => {
    const result = await state.extensionSettings.save(
      toScopeRef(input.target),
      input.expected,
      {
        id: input.id,
        entry: input.entry,
        locked: await lockedFor(state, input.target, input.id),
      },
    );
    if (result.status !== "saved") return result;
    return {
      status: "saved" as const,
      view: await state.extensionViews.view(input.target),
    };
  },
  "extensions.reset": async (state, input) => {
    const result = await state.extensionSettings.reset(
      toScopeRef(input.target),
      input.expected,
      input.id,
      input.fields,
    );
    if (result.status !== "saved") return result;
    return {
      status: "saved" as const,
      view: await state.extensionViews.view(input.target),
    };
  },
  "extensions.trustProject": async (state, input) => {
    const scope = { scope: "project" as const, projectId: input.projectId };
    const read = await state.extensionSettings.read(scope);
    if (read.status === "unavailable" || read.digest === "missing")
      return { status: "conflict" as const };
    const outcome = await withFileMutation(read.path, async () => {
      const bytes = await readFile(read.path);
      if (digestBytes(bytes) !== input.expectedDigest) return "conflict";
      // Trust is by exact content, with the same digest format as the project agent file.
      state.conversationCore.trust.decide({
        kind: "project_capabilities",
        projectId: input.projectId,
        name: "Extension settings",
        path: read.path,
        contentDigest: input.expectedDigest,
        status: input.trusted ? "trusted" : "rejected",
      });
      return "saved";
    });
    if (outcome === "conflict") return { status: "conflict" as const };
    state.admissionPolicy.invalidate();
    await state.extensionSettings.reload(scope);
    return {
      status: "saved" as const,
      trusted: input.trusted,
      view: await state.extensionViews.view({
        scope: "project",
        projectId: input.projectId,
      }),
    };
  },
});
