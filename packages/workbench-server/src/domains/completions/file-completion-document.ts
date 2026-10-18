import type { CompletionItem } from "@nervekit/contracts/completions";
import type { CompletionDocument } from "./completion-provider.js";
import { completionDocumentId } from "./completion-document-identity.js";

const pathDisplay = Object.freeze({ index: 0, offset: 1 });

/** Files have immutable path/kind identity, not content versions. Keep one
 * compact descriptor, projecting labels/details only for native's candidates.
 * No per-file item JSON/version hash or retained normalized candidate graph. */
export class FileCompletionDocument implements CompletionDocument {
  readonly id: string;
  constructor(
    readonly projectId: string,
    private readonly path: string,
    readonly kind: "file" | "directory",
  ) {
    this.id = completionDocumentId(kind, path);
  }
  get version(): string {
    return this.id;
  }
  get retainedUnits(): number {
    return (
      this.id.length +
      this.path.length +
      this.kind.length +
      this.projectId.length
    );
  }
  get fields(): CompletionDocument["fields"] {
    // Native's opaque kinds do not carry directory semantics; the path field
    // uses the same trailing-slash convention as the legacy file adapter.
    return [
      {
        key: "path",
        text: this.kind === "directory" ? `${this.path}/` : this.path,
      },
    ];
  }
  get displayField() {
    return pathDisplay;
  }
  get item(): CompletionItem {
    const label = `@${this.path}${this.kind === "directory" ? "/" : ""}`;
    const slash = this.path.lastIndexOf("/");
    const parent = slash >= 0 ? this.path.slice(0, slash) : "project root";
    return {
      label,
      displayLabel: label,
      apply: label,
      info: this.path,
      detail: `${this.kind === "directory" ? "folder" : "file"} · ${parent}`,
      kind: this.kind,
    };
  }
}
