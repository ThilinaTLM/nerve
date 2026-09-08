import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  applyCapabilityPatch,
  capabilityOverridesDocumentSchema,
  capabilityTrustSchema,
  emptyCapabilityOverrides,
  resolveCapabilitySelection,
  type CapabilityConfiguration,
  type CapabilityOrigin,
  type CapabilityOverridesDocument,
  type CapabilityPatch,
  type CapabilitySelection,
  type CapabilityTrust,
} from "@nervekit/contracts/capabilities";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import { z } from "zod";
import {
  atomicWriteJson,
  managedOwnerPathSegment,
  type InitializedStorage,
} from "../../infrastructure/storage-bootstrap/index.js";

const TRUST_NAMESPACE = "project-capability-trust";
const TRUST_SCOPE = "projects";
const trustRecordSchema = z.object({
  version: z.literal(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  trustedAt: z.string().datetime(),
});

type Publisher = {
  publish(
    type: "project.capabilities.changed",
    data: {
      projectId: string;
      conversationId?: string;
      origin: CapabilityOrigin;
    },
  ): Promise<unknown>;
};

export class CapabilityService {
  readonly #queues = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly getConversation: (
      conversationId: string,
    ) => ConversationRecord,
    private readonly events?: Publisher,
  ) {}

  async configuration(
    projectId: string,
    conversationId?: string,
  ): Promise<CapabilityConfiguration> {
    const project = this.getProject(projectId);
    if (conversationId) this.assertConversation(projectId, conversationId);
    const projectRead = await this.readProject(project);
    const conversationRead = conversationId
      ? await this.readDocument(this.conversationPath(conversationId), true)
      : undefined;
    const trustedProject =
      projectRead.trust.status === "trusted" ? projectRead.document : undefined;
    // Protocol results are persisted for idempotent replay, and that store
    // rejects `undefined` property values, so optional fields are omitted.
    return {
      project: projectRead.document ?? emptyCapabilityOverrides(),
      ...(conversationRead?.document
        ? { conversation: conversationRead.document }
        : {}),
      effective: resolveCapabilitySelection({
        user: this.userSelection(),
        project: trustedProject,
        conversation: conversationRead?.document,
      }),
      trust: projectRead.trust,
      projectDigest: projectRead.digest ?? "missing",
      ...(conversationId
        ? { conversationDigest: conversationRead?.digest ?? "missing" }
        : {}),
    };
  }

  async resolve(
    projectId: string,
    conversationId?: string,
  ): Promise<CapabilitySelection> {
    return (await this.configuration(projectId, conversationId)).effective;
  }

  async update(input: {
    projectId: string;
    conversationId?: string;
    origin: CapabilityOrigin;
    patch?: CapabilityPatch;
    replace?: CapabilityOverridesDocument;
    expectedDigest?: string;
  }): Promise<CapabilityConfiguration> {
    const project = this.getProject(input.projectId);
    const owner =
      input.origin === "project" ? input.projectId : input.conversationId;
    if (!owner)
      throw new Error(
        "Conversation ID is required for conversation capability overrides.",
      );
    if (input.origin === "conversation")
      this.assertConversation(input.projectId, owner);
    const path =
      input.origin === "project"
        ? this.projectPath(project)
        : this.conversationPath(owner);
    await this.exclusive(`${input.origin}:${owner}`, async () => {
      const current = await this.readDocument(
        path,
        input.origin === "conversation",
      );
      if (current.invalidReason) throw new Error(current.invalidReason);
      if (
        input.expectedDigest !== undefined &&
        (current.digest ?? "missing") !== input.expectedDigest
      )
        throw new Error(
          "Capability configuration changed since it was loaded. Refresh and try again.",
        );
      if (
        input.origin === "project" &&
        current.document &&
        (await this.projectTrust(input.projectId)).status === "untrusted"
      )
        throw new Error(
          "Review and trust the project capability file before editing it.",
        );
      const next = input.replace
        ? capabilityOverridesDocumentSchema.parse(input.replace)
        : applyCapabilityPatch(
            current.document ?? emptyCapabilityOverrides(),
            input.patch ?? {},
          );
      await atomicWriteJson(path, next, 0o600);
      if (input.origin === "project")
        await this.trustWrittenProject(input.projectId, path);
    });
    await this.events?.publish("project.capabilities.changed", {
      projectId: input.projectId,
      conversationId: input.origin === "conversation" ? owner : undefined,
      origin: input.origin,
    });
    return this.configuration(input.projectId, input.conversationId);
  }

  async projectTrust(projectId: string): Promise<CapabilityTrust> {
    return (await this.readProject(this.getProject(projectId))).trust;
  }

  async updateTrust(
    projectId: string,
    trusted: boolean,
    expectedDigest?: string,
  ): Promise<CapabilityTrust> {
    const project = this.getProject(projectId);
    if (!trusted) {
      await this.storage.canonicalStore.deleteDocument(
        TRUST_NAMESPACE,
        TRUST_SCOPE,
        projectId,
      );
      return this.projectTrust(projectId);
    }
    const read = await this.readDocument(this.projectPath(project), false);
    if (read.invalidReason)
      return { status: "invalid", reason: read.invalidReason };
    if (!read.document || !read.digest) return { status: "missing" };
    if (expectedDigest && expectedDigest !== read.digest)
      throw new Error(
        "The project capability file changed before it was trusted.",
      );
    await this.writeTrust(projectId, read.digest);
    return this.projectTrust(projectId);
  }

  async writeInitialConversation(
    projectId: string,
    conversationId: string,
    document: CapabilityOverridesDocument,
  ): Promise<void> {
    this.getProject(projectId);
    const parsed = capabilityOverridesDocumentSchema.parse(document);
    await this.exclusive(`conversation:${conversationId}`, () =>
      atomicWriteJson(this.conversationPath(conversationId), parsed, 0o600),
    );
  }

  async removeConversation(conversationId: string): Promise<void> {
    await rm(this.conversationPath(conversationId), { force: true });
  }

  private userSelection(): CapabilitySelection {
    return {
      disabledTools: this.storage.settings.tools.disabled,
      disabledFileSkills: this.storage.settings.skills.disabled,
      enabledAgentBrowserSkills:
        this.storage.settings.skills.agentBrowser.enabled,
    };
  }

  private assertConversation(projectId: string, conversationId: string): void {
    const conversation = this.getConversation(conversationId);
    if (conversation.projectId !== projectId)
      throw new Error("Conversation does not belong to the requested project.");
  }

  private projectPath(project: ProjectRecord): string {
    return join(project.dir, ".nerve", "config", "capabilities.json");
  }

  private conversationPath(conversationId: string): string {
    return join(
      this.storage.paths.conversationsPath,
      managedOwnerPathSegment(conversationId, "conv_"),
      "capabilities.json",
    );
  }

  private async readProject(project: ProjectRecord): Promise<{
    document?: CapabilityOverridesDocument;
    digest?: string;
    trust: CapabilityTrust;
  }> {
    const read = await this.readDocument(this.projectPath(project), false);
    if (read.invalidReason)
      return { trust: { status: "invalid", reason: read.invalidReason } };
    if (!read.document || !read.digest) return { trust: { status: "missing" } };
    const record = await this.storage.canonicalStore.readDocument<unknown>(
      TRUST_NAMESPACE,
      TRUST_SCOPE,
      project.id,
    );
    const parsed = trustRecordSchema.safeParse(record?.data);
    if (!parsed.success || parsed.data.digest !== read.digest) {
      return {
        document: read.document,
        digest: read.digest,
        trust: {
          status: "untrusted",
          digest: read.digest,
          ...(parsed.success
            ? {
                trustedDigest: parsed.data.digest,
                trustedAt: parsed.data.trustedAt,
              }
            : {}),
          reason: parsed.success
            ? "The project capability file changed since it was trusted."
            : "The project capability file has not been trusted.",
        },
      };
    }
    return {
      document: read.document,
      digest: read.digest,
      trust: capabilityTrustSchema.parse({
        status: "trusted",
        digest: read.digest,
        trustedDigest: parsed.data.digest,
        trustedAt: parsed.data.trustedAt,
      }),
    };
  }

  private async readDocument(
    path: string,
    failInvalid: boolean,
  ): Promise<{
    document?: CapabilityOverridesDocument;
    digest?: string;
    invalidReason?: string;
  }> {
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    try {
      const document = capabilityOverridesDocumentSchema.parse(
        JSON.parse(content),
      );
      return { document, digest: digestContent(content) };
    } catch (error) {
      const reason = `Capability configuration at ${path} is invalid: ${error instanceof Error ? error.message : String(error)}`;
      if (failInvalid) throw new Error(reason, { cause: error });
      return { invalidReason: reason };
    }
  }

  private async trustWrittenProject(
    projectId: string,
    path: string,
  ): Promise<void> {
    const content = await readFile(path, "utf8");
    capabilityOverridesDocumentSchema.parse(JSON.parse(content));
    await this.writeTrust(projectId, digestContent(content));
  }

  private async writeTrust(projectId: string, digest: string): Promise<void> {
    await this.exclusive(`trust:${projectId}`, async () => {
      const current = await this.storage.canonicalStore.readDocument(
        TRUST_NAMESPACE,
        TRUST_SCOPE,
        projectId,
      );
      await this.storage.canonicalStore.writeDocument({
        namespace: TRUST_NAMESPACE,
        scopeId: TRUST_SCOPE,
        documentId: projectId,
        data: { version: 1, digest, trustedAt: new Date().toISOString() },
        expectedRevision: current?.revision ?? 0,
      });
    });
  }

  private exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(key, tail);
    return result.finally(() => {
      if (this.#queues.get(key) === tail) this.#queues.delete(key);
    });
  }
}

function digestContent(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
