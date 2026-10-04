export function serverTestRuntimePolicyViolations(file, text) {
  if (!file.startsWith("packages/workbench-server/test/")) return [];

  const violations = [];
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
