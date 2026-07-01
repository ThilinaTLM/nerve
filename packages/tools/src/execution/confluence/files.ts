import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ToolExecutionContext } from "../../types.js";
import {
  type ConfluenceArtifact,
  confluenceTmpDir,
  extractBodyRepresentation,
  extractBodyValue,
  summarizeConfluenceAttachment,
  summarizeConfluencePage,
} from "./format.js";
import { storageXmlToMarkdown } from "./markdown.js";

export type DownloadBundlePage = {
  page: Record<string, unknown>;
  attachments?: unknown[];
  downloadedAttachments?: Array<{ filename: string; bytes: Uint8Array }>;
};

export type DownloadBundleResult = {
  dir: string;
  manifestPath: string;
  pagesJsonlPath: string;
  pages: Array<Record<string, unknown>>;
  artifacts: ConfluenceArtifact[];
  downloadedAttachmentCount: number;
};

export async function writePageSidecars(
  context: ToolExecutionContext,
  page: Record<string, unknown>,
  options: { bodyFormat: string; markdown?: boolean },
): Promise<{
  dir: string;
  storagePath?: string;
  markdownPath?: string;
  artifacts: ConfluenceArtifact[];
}> {
  const summary = summarizeConfluencePage(page);
  const id = summary?.id ?? "page";
  const title = summary?.title ?? "page";
  const body = extractBodyValue(page) ?? "";
  const representation = extractBodyRepresentation(page, options.bodyFormat);
  const dir = join(
    confluenceTmpDir(context),
    `page-${timestamp()}-${shortHash(`${id}\n${title}\n${body}`)}`,
  );
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const artifacts: ConfluenceArtifact[] = [];
  let storagePath: string | undefined;
  let markdownPath: string | undefined;
  if (body) {
    const extension =
      representation === "storage" ? "storage.xml" : `${representation}.json`;
    storagePath = join(dir, `${safeFilename(title)}-${id}.${extension}`);
    await writeUtf8(storagePath, body);
    artifacts.push(
      await artifactForText(storagePath, body, "Confluence page body"),
    );
    if (options.markdown === true && representation === "storage") {
      const markdown = storageXmlToMarkdown(body);
      markdownPath = join(dir, `${safeFilename(title)}-${id}.md`);
      await writeUtf8(markdownPath, markdown);
      artifacts.push(
        await artifactForText(
          markdownPath,
          markdown,
          "Confluence markdown sidecar",
        ),
      );
    }
  }
  return { dir, storagePath, markdownPath, artifacts };
}

export async function writeDownloadBundle(
  context: ToolExecutionContext,
  options: {
    siteUrl: string;
    root: Record<string, unknown>;
    pages: DownloadBundlePage[];
    bodyFormat: string;
    markdown?: boolean;
  },
): Promise<DownloadBundleResult> {
  const rootHash = shortHash(JSON.stringify(options.root));
  const dir = join(
    confluenceTmpDir(context),
    `download-${timestamp()}-${rootHash}`,
  );
  const pagesDir = join(dir, "pages");
  const attachmentsDir = join(dir, "attachments");
  await mkdir(pagesDir, { recursive: true, mode: 0o700 });
  await mkdir(attachmentsDir, { recursive: true, mode: 0o700 });

  const generatedAt = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  const manifestPages: Record<string, unknown>[] = [];
  let downloadedAttachmentCount = 0;

  for (const item of options.pages) {
    const page = item.page;
    const summary = summarizeConfluencePage(page);
    if (!summary) continue;
    const bodyValue = extractBodyValue(page) ?? "";
    const representation = extractBodyRepresentation(page, options.bodyFormat);
    const baseName = `${safeFilename(summary.title ?? "page")}-${summary.id}`;
    const bodyExtension =
      representation === "storage" ? "storage.xml" : `${representation}.json`;
    const storagePath = join(pagesDir, `${baseName}.${bodyExtension}`);
    await writeUtf8(storagePath, bodyValue);
    let markdownPath: string | undefined;
    if (options.markdown === true && representation === "storage") {
      markdownPath = join(pagesDir, `${baseName}.md`);
      await writeUtf8(markdownPath, storageXmlToMarkdown(bodyValue));
    }
    const attachmentSummaries = (item.attachments ?? []).flatMap(
      (attachment) => {
        const summary = summarizeConfluenceAttachment(attachment);
        return summary ? [summary] : [];
      },
    );
    let attachmentDir: string | undefined;
    if ((item.downloadedAttachments?.length ?? 0) > 0) {
      attachmentDir = join(attachmentsDir, summary.id);
      await mkdir(attachmentDir, { recursive: true, mode: 0o700 });
      for (const attachment of item.downloadedAttachments ?? []) {
        const attachmentPath = join(
          attachmentDir,
          safeAttachmentFilename(attachment.filename),
        );
        await writeFile(attachmentPath, attachment.bytes, { mode: 0o600 });
        downloadedAttachmentCount += 1;
      }
    }
    const row = compactRecord({
      schemaVersion: "nerve.confluence.page.v1",
      operation: summary.id ? "update" : "create",
      id: summary.id,
      status: summary.status ?? "current",
      title: summary.title,
      spaceId: summary.spaceId,
      spaceKey: summary.spaceKey,
      parentId: summary.parentId,
      version: { number: summary.versionNumber, message: "" },
      body: { representation, value: bodyValue },
      links: pageLinks(page),
      attachments: attachmentSummaries,
      source: {
        downloadedAt: generatedAt,
        bodyFormat: representation,
      },
    });
    rows.push(row);
    manifestPages.push(
      compactRecord({
        ...summary,
        storagePath,
        markdownPath,
        attachmentDir,
      }),
    );
  }

  const pagesJsonlText = `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length > 0 ? "\n" : ""}`;
  const pagesJsonlPath = join(dir, "pages.jsonl");
  await writeUtf8(pagesJsonlPath, pagesJsonlText);

  const manifest = {
    schemaVersion: "nerve.confluence.download.v1",
    siteUrl: options.siteUrl,
    generatedAt,
    bodyRepresentation: options.bodyFormat,
    root: options.root,
    pagesJsonlPath,
    pages: manifestPages,
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  const manifestPath = join(dir, "manifest.json");
  await writeUtf8(manifestPath, manifestText);

  return {
    dir,
    manifestPath,
    pagesJsonlPath,
    pages: manifestPages,
    artifacts: [
      await artifactForText(
        manifestPath,
        manifestText,
        "Confluence download manifest",
      ),
      await artifactForText(
        pagesJsonlPath,
        pagesJsonlText,
        "Confluence pages JSONL",
      ),
    ],
    downloadedAttachmentCount,
  };
}

function pageLinks(
  page: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const links = asRecord(page.links) ?? asRecord(page._links);
  return links ? compactRecord({ webui: links.webui }) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function compactRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

async function writeUtf8(path: string, text: string): Promise<void> {
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
}

async function artifactForText(
  path: string,
  text: string,
  label: string,
): Promise<ConfluenceArtifact> {
  return {
    path,
    label,
    bytes: Buffer.byteLength(text, "utf8"),
    chars: text.length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
  };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 80) || "page"
  );
}

function safeAttachmentFilename(value: string): string {
  const name = basename(value)
    .replaceAll(/[\\/\0]/g, "_")
    .trim();
  return name.length > 0 ? name : "attachment";
}
