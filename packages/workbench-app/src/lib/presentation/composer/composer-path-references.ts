import type { ComposerReference } from "./composer-editor-api";

const IMAGE_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|bmp|svg|heic|heif|avif|tiff?)$/i;

/**
 * Turn a pasted/dropped/attached path into an `@path` mention reference.
 * Accepts bare paths, quoted paths (`"a b"`), and already-prefixed mentions
 * (`@a`, `"@a b"`). Paths with whitespace or quotes stay quoted as one token.
 */
export function pathMentionReference(
  raw: string,
  hint?: "image",
): ComposerReference {
  let path = raw.trim();
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"'))
    path = path.slice(1, -1).replaceAll('\\"', '"');
  if (path.startsWith("@")) path = path.slice(1);
  const isDirectory = path.length > 1 && path.endsWith("/");
  const name = path.replace(/\/+$/, "").split(/[\\/]/).pop() || path;
  const mention = `@${path}`;
  return {
    insert: /[\s"]/.test(mention)
      ? `"${mention.replaceAll('"', '\\"')}"`
      : mention,
    label: isDirectory ? `${name}/` : name,
    kind:
      hint ??
      (isDirectory
        ? "directory"
        : IMAGE_EXTENSION.test(path)
          ? "image"
          : "file"),
    title: path,
  };
}
