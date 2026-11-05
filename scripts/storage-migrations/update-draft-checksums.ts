// Refresh draft migration checksums after editing a draft step:
//   pnpm storage:checksums
import { defineCli } from "../cli/main.ts";
import { repoRoot } from "../workspace/repo.ts";
import { updateDraftChecksums } from "../release/release-migrations.ts";

await defineCli(import.meta.url, async () => {
  const updates = await updateDraftChecksums(repoRoot);
  if (!updates.length) {
    console.log("Draft migration checksums are current.");
    return;
  }
  for (const { id, from, to } of updates)
    console.log(`${id}: ${from.slice(0, 8)} -> ${to.slice(0, 8)}`);
  console.log(
    "Homes that applied the old draft rerun it only if the step sets rerunOnChange.",
  );
});
