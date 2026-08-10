import { assertWorkspaceVersionsMatch } from "./lib/workspace-packages.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const rawTag = args[0] ?? process.env.GITHUB_REF_NAME ?? "";
const tag = rawTag.replace(/^refs\/tags\//, "");
if (!tag) {
  throw new Error(
    "Missing release tag. Pass a tag argument or set GITHUB_REF_NAME.",
  );
}

const rootVersion = await assertWorkspaceVersionsMatch();
const expectedTag = `v${rootVersion}`;
if (tag !== expectedTag) {
  throw new Error(
    `Release tag ${tag} does not match package version ${rootVersion}. Expected ${expectedTag}.`,
  );
}

console.log(`Release tag ${tag} matches workspace version ${rootVersion}.`);
