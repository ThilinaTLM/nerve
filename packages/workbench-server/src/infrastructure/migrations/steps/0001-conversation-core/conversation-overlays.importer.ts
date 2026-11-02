import { renameWithRetrySync } from "../../framework/durability.js";
import { convertPermissionRules } from "./process-history.js";
import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  capabilityOverridesDocumentSchema,
  resolveCapabilitySelection,
  userCapabilitySelection,
  toolNames,
  type CapabilitySelection,
} from "./capabilities.js";
import { permissionOverlayDocumentForOriginSchema } from "./shapes.js";
import type { Legacy } from "./legacy.reader.js";
import {
  consumeCheckedText,
  isUnreadableDocument,
} from "./config-preflight.js";

export interface ImportedConversationOverlays {
  capabilitiesWritten: number;
  permissionsWritten: number;
}

/** Convert home-owned conversation overlays without consulting project files. */
export class ConversationOverlaysImporter {
  readonly counts: ImportedConversationOverlays = {
    capabilitiesWritten: 0,
    permissionsWritten: 0,
  };
  private user: CapabilitySelection | undefined;

  constructor(
    private readonly home: string,
    private readonly dataDir: string,
  ) {}

  private userSelection(): CapabilitySelection {
    if (this.user) return this.user;
    const read = (name: string): Legacy => {
      const path = join(this.home, "config", `${name}.json`);
      if (isUnreadableDocument(path)) return {};
      try {
        return JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return {};
      }
    };
    this.user = userCapabilitySelection(read("harness"), read("integrations"));
    return this.user;
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
      return consumeCheckedText(path) ?? readFileSync(path, "utf8");
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
      renameWithRetrySync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  importConversation(
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
    let permissions = this.source(join(source, "permissions.json"));
    let normalized = null;
    if (capabilities !== null || enabledTools) {
      const inherited = this.userSelection();
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
      // Project inheritance is deliberately unknown to home migration. Keep
      // explicit opinions rather than erasing them against a guessed baseline.
      normalized = document;
    }
    if (permissions !== null) {
      const document = JSON.parse(permissions);
      if (convertPermissionRules(document))
        permissions = JSON.stringify(document);
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
