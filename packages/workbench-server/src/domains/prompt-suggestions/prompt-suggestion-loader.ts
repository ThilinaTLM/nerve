import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { pathExists } from "../../infrastructure/storage-bootstrap/json.js";
import type { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { suggestionConfiguration } from "./prompt-suggestion-migrations.js";
import {
  parseSuggestionMarkdown,
  type SourceInput,
} from "./prompt-suggestion-document.js";
export { serializePromptSuggestionMarkdown } from "./prompt-suggestion-document.js";
import type {
  PromptSuggestionDefinition,
  PromptSuggestionDiagnostic,
} from "./prompt-suggestion-types.js";
export async function loadPromptSuggestionDefinitions(
  inputs: SourceInput[],
  migrations?: ProjectMigrationService,
): Promise<{
  definitions: PromptSuggestionDefinition[];
  diagnostics: PromptSuggestionDiagnostic[];
}> {
  const definitions: PromptSuggestionDefinition[] = [];
  const diagnostics: PromptSuggestionDiagnostic[] = [];

  for (const input of inputs) {
    if (!(await pathExists(input.dir))) continue;
    let entries: Dirent[];
    try {
      entries = await readdir(input.dir, { withFileTypes: true });
    } catch (error) {
      diagnostics.push({
        type: "warning",
        code: "list_failed",
        message: error instanceof Error ? error.message : String(error),
        path: input.dir,
      });
      continue;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        !entry.isFile() ||
        entry.name.startsWith(".") ||
        !/\.md$/i.test(entry.name)
      ) {
        continue;
      }
      const result = await loadSuggestionFile(
        input,
        join(input.dir, entry.name),
        migrations,
      );
      if (result.definition) definitions.push(result.definition);
      diagnostics.push(...result.diagnostics);
    }
  }

  return { definitions, diagnostics };
}

async function loadSuggestionFile(
  input: SourceInput,
  filePath: string,
  migrations?: ProjectMigrationService,
): Promise<{
  definition?: PromptSuggestionDefinition;
  diagnostics: PromptSuggestionDiagnostic[];
}> {
  const diagnostics: PromptSuggestionDiagnostic[] = [];
  let raw: string;
  try {
    if (input.kind === "project") {
      if (!migrations || !input.projectId)
        throw new Error("Project suggestion migration service is required");
      const type = suggestionConfiguration(basename(filePath));
      migrations.register(type);
      const loaded = await migrations.load(
        { projectId: input.projectId, directory: resolve(input.dir, "../..") },
        type,
      );
      if (
        loaded.classification === "corrupted" ||
        loaded.classification === "incompatible" ||
        !loaded.value
      )
        return {
          diagnostics: [
            {
              type: "warning",
              code: "invalid_metadata",
              path: filePath,
              message:
                "Suggestion is invalid or incompatible; fix it and reload.",
            },
          ],
        };
      raw = type.encode!(loaded.value);
      return parseSuggestionMarkdown(input, filePath, raw);
    }
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    diagnostics.push({
      type: "warning",
      code: "read_failed",
      message: error instanceof Error ? error.message : String(error),
      path: filePath,
    });
    return { diagnostics };
  }

  return parseSuggestionMarkdown(input, filePath, raw);
}
