export function isPackageInstallAllowed(
  globalDefault: "allow" | "deny",
  phaseNetwork: "inherit" | "deny" | "package_registries_only",
): boolean {
  if (phaseNetwork === "deny") return false;
  return (
    globalDefault === "allow" || phaseNetwork === "package_registries_only"
  );
}
