const internalIndexImportPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']*\/index\.js)["']/g;

export function contractsSourcePolicyViolations(file, text) {
  const violations = [];
  if (
    file.startsWith("packages/contracts/src/") &&
    !file.endsWith("/index.ts")
  ) {
    for (const match of text.matchAll(internalIndexImportPattern)) {
      if (match[1].startsWith("."))
        violations.push(
          `contracts source must import the owning file, not ${match[1]}`,
        );
    }
  }
  if (
    file.startsWith("packages/contracts/test/") &&
    file.endsWith(".schema.test.ts")
  )
    violations.push(
      "contracts tests must use behavior-oriented names, not .schema.test.ts",
    );
  return violations;
}
