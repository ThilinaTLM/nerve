export type AdfDocument = {
  type: "doc";
  version: 1;
  content: AdfNode[];
};

type AdfNode = Record<string, unknown>;

export function textToAdf(text: string): AdfDocument {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const content: AdfNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let code: string[] | undefined;

  const flushParagraph = () => {
    const body = paragraph.join("\n").trimEnd();
    paragraph = [];
    if (!body.trim()) return;
    content.push({
      type: "paragraph",
      content: [{ type: "text", text: body }],
    });
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    content.push({
      type: "bulletList",
      content: bullets.map((item) => ({
        type: "listItem",
        content: [
          { type: "paragraph", content: [{ type: "text", text: item }] },
        ],
      })),
    });
    bullets = [];
  };
  const flushCode = () => {
    if (!code) return;
    content.push({
      type: "codeBlock",
      content: [{ type: "text", text: code.join("\n") }],
    });
    code = undefined;
  };
  const flushBlocks = () => {
    flushParagraph();
    flushBullets();
    flushCode();
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim().startsWith("```")) {
      if (code) flushCode();
      else {
        flushParagraph();
        flushBullets();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(rawLine);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushBlocks();
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: [{ type: "text", text: heading[2] }],
      });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      bullets.push(bullet[1]);
      continue;
    }
    if (line.trim().length === 0) {
      flushBlocks();
      continue;
    }
    flushBullets();
    paragraph.push(line);
  }
  flushBlocks();

  return {
    type: "doc",
    version: 1,
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}

export function adfFromEither({
  text,
  adf,
  textName,
  adfName,
}: {
  text: unknown;
  adf: unknown;
  textName: string;
  adfName: string;
}): AdfDocument | Record<string, unknown> | undefined {
  if (typeof text === "string" && adf && typeof adf === "object") {
    throw new Error(`Provide either ${textName} or ${adfName}, not both.`);
  }
  if (adf !== undefined) {
    if (!adf || typeof adf !== "object" || Array.isArray(adf)) {
      throw new Error(`${adfName} must be an ADF object.`);
    }
    return adf as Record<string, unknown>;
  }
  if (typeof text === "string" && text.trim().length > 0)
    return textToAdf(text);
  return undefined;
}
