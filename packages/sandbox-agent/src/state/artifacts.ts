import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactRef } from "@nervekit/contracts";

export type ArtifactScope = {
  conversationId: string;
  agentId: string;
  runId: string;
};

export class ArtifactStore {
  constructor(private readonly stateDir: string) {}

  async writeTextArtifact(
    scope: ArtifactScope,
    nameHint: string,
    text: string,
    mimeType = "text/plain; charset=utf-8",
  ): Promise<ArtifactRef> {
    const bytes = Buffer.byteLength(text);
    const contentId = `sha256:${createHash("sha256").update(text).digest("hex")}`;
    const fileName = `${safe(nameHint)}-${contentId.slice(7, 23)}.txt`;
    const filePath = path.join(this.rootFor(scope), fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, text, "utf8");
    return {
      path: path.relative(this.stateDir, filePath),
      contentId,
      mimeType,
      bytes,
    };
  }

  async boundedTextOrArtifact(
    scope: ArtifactScope,
    nameHint: string,
    text: string,
    options: {
      inlineLimit?: number;
      eventLimit?: number;
      mimeType?: string;
    } = {},
  ): Promise<{
    content:
      | { text: string; truncated?: boolean; bytes?: number }
      | ArtifactRef;
    artifactRef?: ArtifactRef;
  }> {
    const inlineLimit = options.inlineLimit ?? 64_000;
    const eventLimit = options.eventLimit ?? inlineLimit;
    const bytes = Buffer.byteLength(text);
    if (text.length <= inlineLimit) return { content: { text, bytes } };
    const redactedText = text;
    const artifactRef = await this.writeTextArtifact(
      scope,
      nameHint,
      redactedText,
      options.mimeType,
    );
    return {
      content: {
        text: `${text.slice(0, eventLimit)}…`,
        truncated: true,
        bytes,
      },
      artifactRef,
    };
  }

  async boundedJsonOrArtifact(
    scope: ArtifactScope,
    nameHint: string,
    value: unknown,
    options: { inlineLimit?: number; eventLimit?: number } = {},
  ) {
    return this.boundedTextOrArtifact(
      scope,
      nameHint,
      JSON.stringify(value, null, 2),
      { ...options, mimeType: "application/json" },
    );
  }

  private rootFor(scope: ArtifactScope): string {
    return path.join(
      this.stateDir,
      "conversations",
      scope.conversationId,
      "agents",
      scope.agentId,
      "runs",
      scope.runId,
      "artifacts",
    );
  }
}

function safe(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80) || "artifact";
}
