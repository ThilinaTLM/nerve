import { isMermaidLanguage } from "./mermaid-render.js";
import remarkParse from "remark-parse";
import { unified } from "unified";

export type MermaidBlockLocator = {
  ordinal: number;
  startLine: number;
  fingerprint: string;
};

export type MermaidMarkdownBlock = {
  source: string;
  locator: MermaidBlockLocator;
};

type MarkdownNode = {
  type?: string;
  lang?: string | null;
  value?: string;
  position?: { start?: { line?: number } };
  children?: MarkdownNode[];
};

function normalizedSource(source: string): string {
  return source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd();
}

function fnv1a(source: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function fingerprintMermaidSource(source: string): string {
  const normalized = normalizedSource(source);
  return `${fnv1a(normalized, 0x811c9dc5)}${fnv1a(normalized, 0x9e3779b9)}`;
}

export function extractMermaidMarkdownBlocks(
  markdown: string,
  sourceLineStart = 1,
): MermaidMarkdownBlock[] {
  let tree: MarkdownNode;
  try {
    tree = unified().use(remarkParse).parse(markdown) as MarkdownNode;
  } catch {
    return [];
  }

  const blocks: MermaidMarkdownBlock[] = [];
  const visit = (node: MarkdownNode) => {
    if (
      node.type === "code" &&
      isMermaidLanguage(node.lang ?? undefined) &&
      typeof node.value === "string"
    ) {
      const source = node.value;
      const relativeLine = node.position?.start?.line ?? 1;
      blocks.push({
        source,
        locator: {
          ordinal: blocks.length,
          startLine: sourceLineStart + relativeLine - 1,
          fingerprint: fingerprintMermaidSource(source),
        },
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return blocks;
}

export function resolveMermaidMarkdownBlock(
  blocks: MermaidMarkdownBlock[],
  locator: MermaidBlockLocator,
  options: { completeDocument: boolean },
): MermaidMarkdownBlock | undefined {
  const fingerprintMatches = blocks.filter(
    (block) => block.locator.fingerprint === locator.fingerprint,
  );
  if (fingerprintMatches.length > 0) {
    return fingerprintMatches.reduce((closest, candidate) =>
      Math.abs(candidate.locator.startLine - locator.startLine) <
      Math.abs(closest.locator.startLine - locator.startLine)
        ? candidate
        : closest,
    );
  }

  if (options.completeDocument) {
    return blocks[locator.ordinal];
  }

  if (blocks.length === 0) return undefined;
  return blocks.reduce((closest, candidate) =>
    Math.abs(candidate.locator.startLine - locator.startLine) <
    Math.abs(closest.locator.startLine - locator.startLine)
      ? candidate
      : closest,
  );
}
