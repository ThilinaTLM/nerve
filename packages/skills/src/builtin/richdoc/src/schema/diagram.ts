/** Rendering sources cannot introduce config, HTML assets or external URLs. */
export function checkDiagram(source: string) {
  if (
    /%%\s*\{|^\s*---|@\s*\{|\b(?:https?|ftp|file|data|javascript):|\burl\s*\(|<\s*(?:img|iframe|script|style|svg|link)\b/im.test(
      source,
    )
  ) {
    throw new Error(
      "Use plain Mermaid without configuration directives, image/icon shapes, HTML resources, CSS URLs or external URLs.",
    );
  }
}
