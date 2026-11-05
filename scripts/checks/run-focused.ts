// Entry point for `pnpm fix:focused` and `pnpm check:focused`: run-focused.ts <fix|check> [flags].
import { repoRoot } from "../workspace/repo.ts";
import { main } from "./focused-validation-runner.ts";

const [operation = "", ...args] = process.argv.slice(2);
await main(operation, repoRoot, { args });
