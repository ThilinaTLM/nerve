import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CoreStorage, PermissionPort } from "@nervekit/conversation-core";
import { createId } from "@nervekit/contracts";
import { supervisionSchema } from "@nervekit/contracts/core";
import { toolNameSchema } from "@nervekit/contracts/tools";
import {
  permissionOverlayDocumentForOriginSchema,
  permissionRuleSchema,
  type PermissionOverlayDocument,
  type PermissionOverlayOrigin,
} from "@nervekit/contracts/permissions";
import {
  composeEffectivePermissionPolicy,
  evaluatePermissionRequest,
  normalizePermissionRequest,
} from "@nervekit/tools/policy";
import { atomicWriteJson } from "../infrastructure/storage-bootstrap/index.js";
import { listPermissionRuleSets } from "./permission-rule-sets.js";

export function createPermissionPort(
  home: string,
  storage: CoreStorage,
): PermissionPort {
  const paths = (conversationId: string, projectDir: string) => ({
    user: join(home, "config", "permissions.json"),
    project: join(projectDir, ".nerve", "config", "permissions.json"),
    conversation: join(
      home,
      "data",
      "conversations",
      conversationId,
      "config",
      "permissions.json",
    ),
  });
  const load = async (
    origin: PermissionOverlayOrigin,
    path: string,
  ): Promise<PermissionOverlayDocument> => {
    try {
      return permissionOverlayDocumentForOriginSchema(origin).parse(
        JSON.parse(await readFile(path, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { schemaVersion: 2, overlays: [] };
      throw error;
    }
  };
  const writes = new Map<string, Promise<void>>();
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
      const user = await load("user", path.user);
      const conversation = await load("conversation", path.conversation);
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
        const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
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
      const request = normalizePermissionRequest({
        toolName: toolNameSchema.parse(input.toolName),
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
      return supervisionSchema.parse({
        decision: result.decision === "prompt" ? "approval" : result.decision,
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
      const write = (writes.get(path) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          const document = await load(input.scope, path);
          let overlay = document.overlays.find(
            (item) => item.ruleSetId === input.ruleSetId,
          );
          if (!overlay) {
            overlay = { ruleSetId: input.ruleSetId, rules: [] };
            document.overlays.push(overlay);
          }
          const rule = permissionRuleSchema.parse(input.rule);
          overlay.rules = [
            ...overlay.rules.filter((item) => item.id !== rule.id),
            rule,
          ];
          const parsed = permissionOverlayDocumentForOriginSchema(
            input.scope,
          ).parse(document);
          await atomicWriteJson(path, parsed, 0o600);
          if (input.scope === "project") {
            const projectId = storage.conversations.get(
              input.conversationId,
            )?.projectId;
            if (!projectId) throw new Error("Conversation not found");
            const contentDigest = `sha256:${createHash("sha256")
              .update(await readFile(path))
              .digest("hex")}`;
            const existing = storage.trustedResources.find(
              "project_permissions",
              projectId,
              path,
            );
            const now = new Date().toISOString();
            if (existing)
              storage.trustedResources.update(existing.id, {
                contentDigest,
                status: "trusted",
                updatedAt: now,
              });
            else
              storage.trustedResources.insert({
                id: createId("trust"),
                kind: "project_permissions",
                projectId,
                path,
                name: null,
                contentDigest,
                status: "trusted",
                createdAt: now,
                updatedAt: now,
              });
          }
        });
      writes.set(path, write);
      try {
        await write;
      } finally {
        if (writes.get(path) === write) writes.delete(path);
      }
    },
  };
}
