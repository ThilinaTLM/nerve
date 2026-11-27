import {
  toTrustedDigest,
  type TrustedResource,
} from "@nervekit/contracts/core";
import { readFile } from "node:fs/promises";
import type { ExtensionTarget } from "@nervekit/contracts/extensions";
import { withFileMutation } from "../../../infrastructure/storage-bootstrap/file-mutations.js";
import { digestBytes } from "../../../infrastructure/configuration/scoped-store/scoped-document-store.js";
import { toScopeRef } from "../../../core-host/extensions/extension-views.js";
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
  // Frames of installed extensions asking the daemon for files, settings, the project or their
  // own backend. Only the signed-in user's app sends these (it validated the frame's request);
  // `call` is the user's action and does not go through the permission engine.
  "extensions.ui.contributions": (state, { projectId }) =>
    state.extensionUi.contributions(projectId),
  "extensions.ui.themes": (state) => state.extensionUi.themes(),
  "extensions.ui.file.info": (state, input) =>
    state.extensionUi.bridge("file.info", input),
  "extensions.ui.file.read": (state, input) =>
    state.extensionUi.bridge("file.read", input),
  "extensions.ui.file.write": (state, input) =>
    state.extensionUi.bridge("file.write", input),
  "extensions.ui.settings.get": (state, input) =>
    state.extensionUi.bridge("settings.get", input),
  "extensions.ui.project.info": (state, input) =>
    state.extensionUi.bridge("project.info", input),
  "extensions.ui.backend.call": (state, input) =>
    state.extensionUi.bridge("backend.call", input),
  "extensions.ui.chat.startConversation": (state, input) =>
    state.extensionUi.bridge("chat.startConversation", input),
  "extensions.ui.store.get": (state, input) =>
    state.extensionUi.bridge("store.get", input),
  "extensions.ui.store.set": (state, input) =>
    state.extensionUi.bridge("store.set", input),
  "extensions.ui.store.delete": (state, input) =>
    state.extensionUi.bridge("store.delete", input),
  "extensions.ui.store.keys": (state, input) =>
    state.extensionUi.bridge("store.keys", input),
  "extensions.ui.reportFrameError": (state, input) =>
    state.extensionUi.reportFrameError(input),
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
  // Reload and the project file's trust: user-initiated operations of Settings → Extensions. They
  // are protocol methods of the authenticated app connection; agents reach tools and `quick_script`
  // namespaces only, and neither has an operation like these. Consent itself is
  // `configuration.decide`.
  "extensions.reload": async (state, input) => {
    await state.extensionCatalog.reload(input.id);
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
    let decided: TrustedResource | undefined;
    const outcome = await withFileMutation(read.path, async () => {
      const bytes = await readFile(read.path);
      if (digestBytes(bytes) !== input.expectedDigest) return "conflict";
      // Trust is by exact content, with the same digest format as the project agent file.
      decided = state.conversationCore.trust.decide({
        kind: "capabilities",
        projectId: input.projectId,
        name: "Extension settings",
        resourceKey: read.path,
        contentDigest: toTrustedDigest(input.expectedDigest),
        status: input.trusted ? "trusted" : "rejected",
      });
      return "saved";
    });
    if (outcome === "conflict") return { status: "conflict" as const };
    state.admissionPolicy.invalidate();
    await state.extensionSettings.reload(scope);
    return {
      status: "saved" as const,
      trustState: state.conversationCore.trust.trustState(
        decided,
        toTrustedDigest(input.expectedDigest),
      ),
      view: await state.extensionViews.view({
        scope: "project",
        projectId: input.projectId,
      }),
    };
  },
});
