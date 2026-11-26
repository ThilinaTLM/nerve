import { isAbsolute } from "node:path";

export function isUnsafeCompletionQuery(query: string): boolean {
  if (!query) return false;
  query = query.replaceAll("\\", "/");
  if (
    query.startsWith("/") ||
    query.startsWith("//") ||
    /^[A-Za-z]:\//.test(query) ||
    isAbsolute(query)
  ) {
    return true;
  }
  return query.split("/").some((segment) => segment === "..");
}
