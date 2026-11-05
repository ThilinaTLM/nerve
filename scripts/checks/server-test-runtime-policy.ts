import { defineFileRule } from "./policy.ts";

export function serverTestRuntimePolicyViolations(
  file: string,
  text: string,
): string[] {
  if (!file.startsWith("packages/workbench-server/test/")) return [];

  const violations: string[] = [];
  if (/\b(?:TestServerRuntime|createTestServerRuntime)\b/.test(text))
    violations.push("server tests must use the explicit RuntimeFixture shape");
  if (
    /Object\.assign\(\s*[^,)]*runtime\s*,\s*\{[^}]*services\s*:/s.test(text) ||
    /\bServerRuntime\s*&\s*\{[^}]*\bservices\s*:/s.test(text)
  )
    violations.push(
      "server tests must not augment ServerRuntime with services",
    );
  return violations;
}

export const serverTestRuntimeRule = defineFileRule(
  "server-test-runtime",
  "server tests use the explicit RuntimeFixture shape",
  (file, read) =>
    file.startsWith("packages/workbench-server/test/")
      ? serverTestRuntimePolicyViolations(file, read())
      : [],
);
