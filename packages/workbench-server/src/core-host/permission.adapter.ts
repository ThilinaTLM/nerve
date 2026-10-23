import { join } from "node:path";
import type { CoreStorage, PermissionPort } from "@nervekit/conversation-core";
import { permissionRuleSchema } from "@nervekit/contracts/permissions";
import {
  mutatePermissionOverlay,
  trustProjectPermissions,
} from "./permission-overlays.js";
import {
  ConfigurationScopePaths,
  userConfigurationRoot,
} from "../infrastructure/configuration/scope-paths.js";
import {
  createExecutionAdmission,
  type AdmissionPolicySource,
} from "./execution-admission/admission.js";

export function createPermissionPort(
  home: string,
  storage: CoreStorage,
  admissionPolicy: AdmissionPolicySource,
): PermissionPort {
  const paths = (conversationId: string, projectDir: string) => {
    const resolver = new ConfigurationScopePaths({
      userConfigPath: userConfigurationRoot(home),
      conversationsPath: join(home, "data", "conversations"),
      // The core supplies the active project's directory to the permission port.
      projectDirectory: () => projectDir,
      projectOf: (id) => {
        const conversation = storage.conversations.get(id);
        if (!conversation) throw new Error("Conversation not found");
        return conversation.projectId;
      },
    });
    const conversation = resolver.resolve(
      { scope: "conversation", conversationId },
      "permissions.json",
    );
    return {
      user: resolver.resolve({ scope: "user" }, "permissions.json").path,
      project: resolver.resolve(
        { scope: "project", projectId: conversation.projectId },
        "permissions.json",
      ).path,
      conversation: conversation.path,
    };
  };
  return {
    prepareAdmission: createExecutionAdmission(admissionPolicy),
    async addRule(input) {
      const path = paths(input.conversationId, input.projectDir)[input.scope];
      const rule = permissionRuleSchema.parse(input.rule);
      await mutatePermissionOverlay(input.scope, path, (document) => {
        let overlay = document.overlays.find(
          (item) => item.ruleSetId === input.ruleSetId,
        );
        if (!overlay) {
          overlay = { ruleSetId: input.ruleSetId, rules: [] };
          document.overlays.push(overlay);
        }
        overlay.rules = [
          ...overlay.rules.filter((item) => item.id !== rule.id),
          rule,
        ];
      });
      admissionPolicy.invalidate();
      if (input.scope === "project") {
        const projectId = storage.conversations.get(
          input.conversationId,
        )?.projectId;
        if (!projectId) throw new Error("Conversation not found");
        await trustProjectPermissions(storage, projectId, path);
        admissionPolicy.invalidate();
      }
    },
  };
}
