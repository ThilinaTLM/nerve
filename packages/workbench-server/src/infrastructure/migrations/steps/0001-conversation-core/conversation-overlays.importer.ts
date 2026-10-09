import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  capabilityOverridesDocumentSchema,
  normalizeCapabilityOverrides,
  resolveCapabilitySelection,
  userCapabilitySelection,
  toolNames,
  type CapabilitySelection,
} from "./capabilities.js";
import { permissionOverlayDocumentForOriginSchema } from "./shapes.js";
import type { CoreStorage } from "./storage.js";
import type { ImportReport, Legacy } from "./legacy.reader.js";

export interface ImportedConversationOverlays {
  capabilitiesWritten: number;
  permissionsWritten: number;
}

/** Read the same effective layers as the host; never initialize or edit them. */
export class ConversationOverlaysImporter {
  readonly counts: ImportedConversationOverlays = {
    capabilitiesWritten: 0,
    permissionsWritten: 0,
  };
  private user: CapabilitySelection | undefined;
  private readonly projects = new Map<string, CapabilitySelection>();

  constructor(
    private readonly home: string,
    private readonly dataDir: string,
    private readonly storage: CoreStorage,
    private readonly report: ImportReport,
  ) {}

  private userSelection(): CapabilitySelection {
    if (this.user) return this.user;
    const read = (name: string): Legacy => {
      try {
        return JSON.parse(
          readFileSync(join(this.home, "config", `${name}.json`), "utf8"),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return {};
      }
    };
    this.user = userCapabilitySelection(read("harness"), read("integrations"));
    return this.user;
  }

  private inherited(projectId: string): CapabilitySelection {
    const cached = this.projects.get(projectId);
    if (cached) return cached;
    const user = this.userSelection();
    const project = this.storage.projects.get(projectId);
    if (!project) throw new Error(`Missing overlay project ${projectId}`);
    const path = join(
      project.directory,
      ".nerve",
      "config",
      "capabilities.json",
    );
    const trust = this.storage.trustedResources.find(
      "project_capabilities",
      projectId,
      path,
    );
    let document;
    try {
      const content = readFileSync(path, "utf8");
      const parsed = capabilityOverridesDocumentSchema.parse(
        JSON.parse(content),
      );
      const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      if (trust?.status === "trusted" && trust.contentDigest === digest)
        document = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.report.skip(
          "Invalid project capability layer; inherited user selection instead",
        );
    }
    const inherited = resolveCapabilitySelection({ user, project: document });
    this.projects.set(projectId, inherited);
    return inherited;
  }

  private assertContained(path: string): void {
    const rel = relative(this.dataDir, realpathSync(path));
    if (isAbsolute(rel) || rel === ".." || rel.startsWith("../"))
      throw new Error("Conversation overlay path escapes the data directory");
  }

  private source(path: string): string | null {
    try {
      if (!lstatSync(path).isFile())
        throw new Error("Legacy overlay must be a regular file");
      this.assertContained(path);
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private write(path: string, content: string): void {
    let parent = dirname(path);
    while (parent !== this.dataDir) {
      try {
        if (lstatSync(parent).isSymbolicLink())
          throw new Error(
            "Conversation overlay destination must not use symbolic links",
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      parent = dirname(parent);
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.assertContained(dirname(path));
    const temporary = `${path}.import-${randomUUID()}`;
    try {
      writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  importConversation(
    projectId: string,
    oldId: string,
    newId: string,
    enabledTools?: string[],
  ): void {
    if (
      !/^conv_[A-Za-z0-9_-]+$/.test(oldId) ||
      !/^conv_[A-Za-z0-9_-]+$/.test(newId)
    )
      throw new Error("Invalid conversation overlay owner ID");
    const source = join(
      this.dataDir,
      "conversations",
      oldId.slice("conv_".length),
    );
    const target = join(this.dataDir, "conversations", newId, "config");
    const capabilities = this.source(join(source, "capabilities.json"));
    const permissions = this.source(join(source, "permissions.json"));
    let normalized = null;
    if (capabilities !== null || enabledTools) {
      const inherited = this.inherited(projectId);
      const document = capabilityOverridesDocumentSchema.parse(
        capabilities === null ? { schemaVersion: 2 } : JSON.parse(capabilities),
      );
      if (enabledTools) {
        const oldEffective = resolveCapabilitySelection({
          user: inherited,
          conversation: document,
        });
        for (const name of toolNames) {
          const enabled =
            name === "subagents"
              ? [
                  "subagent_new",
                  "subagent_prompt",
                  "subagent_list",
                  "subagent_status",
                  "subagent_stop",
                ].every((tool) => enabledTools.includes(tool))
              : name === "jira" || name === "confluence"
                ? enabledTools.some((tool) => tool.startsWith(`${name}_`))
                : enabledTools.includes(name);
          const profileId = oldEffective.toolProfiles[name];
          document.tools[name] = {
            enabled,
            ...(profileId ? { profileId } : {}),
          };
        }
        Object.assign(document.toolSettings, oldEffective.toolSettings);
      }
      normalized = normalizeCapabilityOverrides(document, inherited);
    }
    // Validate both before creating files; permission relocation preserves bytes.
    if (permissions !== null)
      permissionOverlayDocumentForOriginSchema("conversation").parse(
        JSON.parse(permissions),
      );
    if (normalized !== null) {
      this.write(
        join(target, "capabilities.json"),
        `${JSON.stringify(normalized, null, 2)}\n`,
      );
      this.counts.capabilitiesWritten++;
    }
    if (permissions !== null) {
      this.write(join(target, "permissions.json"), permissions);
      this.counts.permissionsWritten++;
    }
  }
}
