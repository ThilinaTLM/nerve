import type { BashToolSettings } from "@nervekit/contracts/settings";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CoreStorage, PermissionPort } from "@nervekit/conversation-core";
import { supervisionSchema } from "@nervekit/contracts/core";
import { toolNameSchema } from "@nervekit/contracts/tools";
import {
  permissionOverlayDocumentForOriginSchema,
  permissionRuleSchema,
  type PermissionOverlayDocument,
} from "@nervekit/contracts/permissions";
import {
  composeEffectivePermissionPolicy,
  evaluatePermissionRequest,
  normalizePermissionRequest,
} from "@nervekit/tools/policy";
import {
  buildBashToolDefinition,
  classifyToolRisk,
} from "@nervekit/tools/catalog";
import {
  emptyOverlayDocument,
  loadPermissionOverlay,
  mutatePermissionOverlay,
  overlayDigest,
  trustProjectPermissions,
} from "./permission-overlays.js";
import {
  assertHomeConfigurationPathWritable,
  isHomeConfigurationInvalid,
} from "../infrastructure/configuration/home-configuration.js";
import { listPermissionRuleSets } from "./permission-rule-sets.js";
import { requiresBashTimeoutArgument } from "./tool-host.adapter.js";
import {
  ConfigurationScopePaths,
  userConfigurationRoot,
} from "../infrastructure/configuration/scope-paths.js";

export function createPermissionPort(
  home: string,
  storage: CoreStorage,
  bashSettings?: (
    projectDir: string,
    conversationId: string,
  ) => Promise<BashToolSettings>,
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
    async evaluate(input) {
      const selected = (await listPermissionRuleSets(home)).find(
        (ruleSet) => ruleSet.id === input.ruleSetId && ruleSet.enabled,
      );
      if (!selected)
        throw new Error(
          `Unknown or disabled permission rule set: ${input.ruleSetId}`,
        );
      const path = paths(input.conversationId, input.projectDir);
      let recoveryApproval = isHomeConfigurationInvalid(
        join(userConfigurationRoot(home), "harness.json"),
      );
      const user = await (async () => {
        assertHomeConfigurationPathWritable(path.user);
        return loadPermissionOverlay("user", path.user);
      })().catch(() => {
        recoveryApproval = true;
        return emptyOverlayDocument();
      });
      const conversation = await loadPermissionOverlay(
        "conversation",
        path.conversation,
      );
      const projectId = storage.conversations.get(
        input.conversationId,
      )?.projectId;
      const trusted = storage.trustedResources.find(
        "project_permissions",
        projectId ?? null,
        path.project,
      );
      let project: PermissionOverlayDocument | undefined;
      if (trusted?.status === "trusted") {
        const content = await readFile(path.project, "utf8");
        const digest = overlayDigest(content);
        if (trusted.contentDigest === digest)
          project = permissionOverlayDocumentForOriginSchema("project").parse(
            JSON.parse(content),
          );
      }
      const overlay = (document?: PermissionOverlayDocument) =>
        document?.overlays.find((item) => item.ruleSetId === selected.id);
      const policy = composeEffectivePermissionPolicy({
        selectedRuleSet: selected,
        userOverlay: overlay(user),
        projectOverlay: overlay(project),
        conversationOverlay: overlay(conversation),
      });
      const settings =
        input.toolName === "bash" && bashSettings
          ? await bashSettings(input.projectDir, input.conversationId)
          : undefined;
      const definition = settings
        ? buildBashToolDefinition({
            ...settings,
            autoPromotion: {
              ...settings.autoPromotion,
              enabled: !requiresBashTimeoutArgument(settings, input.origin),
            },
          })
        : undefined;
      const request = normalizePermissionRequest({
        toolName: toolNameSchema.parse(input.toolName),
        definition,
        args: input.args as Record<string, unknown>,
        conversationId: input.conversationId,
        projectId,
        cwd: input.cwd,
        roots: {
          project: input.projectDir,
          nerve_home: home,
          nerve_data: join(home, "data"),
          plans: join(home, "data", "plans"),
        },
      });
      const result = evaluatePermissionRequest({ policy, request });
      const effectiveRisk = classifyToolRisk(input.toolName, request.args);
      // Defaults and existing autonomous selections can allow reads/execution.
      // An unreadable authorization document must never turn lost restrictions
      // into permission to execute. Preserve denials; require per-call approval
      // for everything else until the user explicitly resets or reloads it.
      if (recoveryApproval && result.decision !== "deny") {
        return supervisionSchema.parse({
          decision: "approval",
          effectiveRisk,
          suggestedRules: [],
          reason:
            "Authorization settings are invalid. Explicit approval is required until harness and permissions settings are reset or reloaded.",
          authority: {
            ruleSetId: selected.id,
            policySnapshotHash: `${policy.snapshotHash}:settings-recovery`,
          },
        });
      }
      return supervisionSchema.parse({
        decision: result.decision === "prompt" ? "approval" : result.decision,
        effectiveRisk,
        reason: result.reason,
        matchedRule: result.winningRule,
        suggestedRules: result.suggestedRules,
        authority: JSON.parse(
          JSON.stringify({
            ruleSetId: selected.id,
            policySnapshotHash: policy.snapshotHash,
          }),
        ),
      });
    },
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
      if (input.scope === "project") {
        const projectId = storage.conversations.get(
          input.conversationId,
        )?.projectId;
        if (!projectId) throw new Error("Conversation not found");
        await trustProjectPermissions(storage, projectId, path);
      }
    },
  };
}
