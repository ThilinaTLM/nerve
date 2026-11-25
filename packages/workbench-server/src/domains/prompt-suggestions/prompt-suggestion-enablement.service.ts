import { dirname, join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { TrustState } from "@nervekit/contracts/core";
import type { ProjectMigrationTrust } from "../../infrastructure/configuration/project-migration/project-migration.js";
import {
  atomicWriteJson,
  readJsonFile,
} from "../../infrastructure/storage-bootstrap/index.js";

const settingsSchema = z.object({
  version: z.literal(1),
  enabled: z.record(z.string(), z.boolean()),
});

/** The kind of file the trust decisions of project settings files are keyed to. */
export const PROJECT_SUGGESTION_SETTINGS_TYPE = "prompt-suggestions";

/**
 * How the project's choices file is trusted: by exact content, like the other
 * project settings files. `capture` carries an existing approval to the bytes
 * Nerve writes for the user.
 */
export interface ProjectSuggestionFileTrust {
  state(projectId: string, path: string, digest: string): TrustState;
  decide(input: {
    projectId: string;
    path: string;
    digest: string;
    trusted: boolean;
  }): void;
  capture: ProjectMigrationTrust["capture"];
}

/** A project's choices file as the settings surface sees it. */
export type ProjectSuggestionFile = {
  path: string;
  /** Hex sha-256 of the bytes; absent while there is no file. */
  digest?: string;
  status: "missing" | "invalid" | TrustState;
  /** Empty unless the file is trusted: other bytes are ignored. */
  choices: Record<string, boolean>;
};

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** One layer's enable choices by definition key; absent keys inherit. */
export class PromptSuggestionEnablementFile {
  private mutation = Promise.resolve();

  constructor(readonly path: string) {}

  async list(): Promise<Record<string, boolean>> {
    const raw = await readJsonFile(this.path, settingsSchema).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return { version: 1, enabled: {} };
        throw error;
      },
    );
    return raw.enabled;
  }

  /**
   * `null` removes the choice so the layer inherits again. `around` wraps the
   * write with the bytes it replaces, so trust can follow the new bytes.
   */
  async set(
    definitionKey: string,
    enabled: boolean | null,
    around?: (
      before: Buffer | undefined,
      write: () => Promise<Buffer>,
    ) => Promise<void>,
  ): Promise<void> {
    if (!definitionKey.trim())
      throw new Error("A suggestion definition key is required");
    const operation = this.mutation.then(async () => {
      const preferences = await this.list();
      if (enabled === null) delete preferences[definitionKey];
      else preferences[definitionKey] = enabled;
      // The bytes this write puts on disk, so trust follows exactly them and never a re-read.
      const write = async () => {
        await mkdir(dirname(this.path), { recursive: true });
        const value = { version: 1, enabled: preferences };
        await atomicWriteJson(this.path, value, 0o600);
        return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      };
      if (!around) {
        await write();
        return;
      }
      const before = await readFile(this.path).catch(() => undefined);
      await around(before, write);
    });
    this.mutation = operation.catch(() => undefined);
    await operation;
  }
}

/**
 * Enablement is a settings file per layer, not conversation facts: the user's
 * `<config>/prompt-suggestions.json` and each project's
 * `.nerve/config/prompt-suggestions.json`. Effective = project ?? user ?? default.
 * A project file counts only while its exact content is trusted.
 */
export class PromptSuggestionEnablementService {
  private readonly user: PromptSuggestionEnablementFile;
  private readonly projects = new Map<string, PromptSuggestionEnablementFile>();

  constructor(
    configDir: string,
    private readonly trust: ProjectSuggestionFileTrust,
  ) {
    this.user = new PromptSuggestionEnablementFile(
      join(configDir, "prompt-suggestions.json"),
    );
  }

  list(): Promise<Record<string, boolean>> {
    return this.user.list();
  }

  set(definitionKey: string, enabled: boolean | null): Promise<void> {
    return this.user.set(definitionKey, enabled);
  }

  /** A project's file with its trust state; only a trusted file contributes choices. */
  async projectFile(
    projectId: string,
    projectDir: string,
  ): Promise<ProjectSuggestionFile> {
    const file = this.project(projectDir);
    const path = file.path;
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      return { path, status: "missing", choices: {} };
    }
    const digest = sha256(bytes);
    const choices = await file.list().catch(() => undefined);
    if (!choices) return { path, digest, status: "invalid", choices: {} };
    const status = this.trust.state(projectId, path, `sha256:${digest}`);
    return {
      path,
      digest,
      status,
      choices: status === "trusted" ? choices : {},
    };
  }

  /** Trusts or rejects the exact bytes the user reviewed; false when the file changed since. */
  async decideProjectFile(input: {
    projectId: string;
    projectDir: string;
    expectedDigest: string;
    trusted: boolean;
  }): Promise<boolean> {
    const file = await this.projectFile(input.projectId, input.projectDir);
    if (file.digest === undefined || file.digest !== input.expectedDigest)
      return false;
    this.trust.decide({
      projectId: input.projectId,
      path: file.path,
      digest: `sha256:${file.digest}`,
      trusted: input.trusted,
    });
    return true;
  }

  /**
   * Writes on the user's behalf: a trusted file stays trusted and a new file
   * is trusted; a file that needs review or was declined stays as it is.
   */
  async setProject(
    projectId: string,
    projectDir: string,
    definitionKey: string,
    enabled: boolean | null,
  ): Promise<void> {
    const file = this.project(projectDir);
    await file.set(definitionKey, enabled, async (before, write) => {
      const carry = await this.trust.capture({
        type: PROJECT_SUGGESTION_SETTINGS_TYPE,
        projectId,
        path: file.path,
        source: before,
      });
      const written = await write();
      await carry?.(file.path, written);
    });
  }

  private project(projectDir: string): PromptSuggestionEnablementFile {
    let file = this.projects.get(projectDir);
    if (!file) {
      file = new PromptSuggestionEnablementFile(
        join(projectDir, ".nerve", "config", "prompt-suggestions.json"),
      );
      this.projects.set(projectDir, file);
    }
    return file;
  }
}
