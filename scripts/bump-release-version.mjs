import { setWorkspaceVersion } from "./lib/release-version.mjs";
import { repoRoot } from "./lib/workspace-packages.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const version = args[0];
const changedPaths = await setWorkspaceVersion(repoRoot, version);

if (changedPaths.length === 0) {
  console.log(`Workspace manifests already use version ${version}.`);
} else {
  console.log(`Updated workspace manifests to version ${version}:`);
  for (const path of changedPaths) console.log(`  ${path}`);
}
