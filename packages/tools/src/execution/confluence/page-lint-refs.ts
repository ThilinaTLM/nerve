import { getAttr, textOf, walk, type XmlElement } from "./storage-xml.js";

/** An `ri:attachment` (image, link, view-file) naming a file that is not on the page renders broken. */
export function lintAttachmentRefs(
  root: XmlElement,
  attached: ReadonlySet<string> | undefined,
  warnings: string[],
): void {
  if (!attached) return;
  const missing = new Set<string>();
  walk(root, (element) => {
    if (element.name !== "ri:attachment") return undefined;
    const filename = getAttr(element, "ri:filename");
    // An attachment of another page names that page and is not ours to check.
    const ofOtherPage = element.children.some(
      (c) => c.kind === "element" && c.name === "ri:page",
    );
    if (filename && !ofOtherPage && !attached.has(filename))
      missing.add(filename);
    return undefined;
  });
  for (const name of missing) {
    warnings.push(
      `Body references attachment "${name}" that is not on the page; pass it in attachments (or upload it first).`,
    );
  }
}

/** Task ids must be unique on a page; appended Markdown or builder tasks may reuse ids of existing ones. */
export function lintTaskIds(root: XmlElement, fixes: string[]): void {
  const idElements: XmlElement[] = [];
  walk(root, (element) => {
    if (element.name === "ac:task-id") idElements.push(element);
    return undefined;
  });
  const used = new Set<string>();
  let max = 0;
  for (const element of idElements) {
    const id = textOf(element).trim();
    if (/^\d+$/.test(id)) max = Math.max(max, Number(id));
  }
  let renumbered = 0;
  for (const element of idElements) {
    const id = textOf(element).trim();
    if (used.has(id)) {
      max += 1;
      element.children = [{ kind: "text", value: String(max) }];
      used.add(String(max));
      renumbered += 1;
    } else used.add(id);
  }
  if (renumbered > 0) {
    fixes.push(
      `Renumbered ${renumbered} duplicate task id${renumbered === 1 ? "" : "s"}.`,
    );
  }
}
