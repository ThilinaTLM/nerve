import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { describe } from "../schema/index.js";
import { prepare } from "./prepare.js";
import { validate } from "../validation/index.js";

const HELP =
  "node <skill>/scripts/richdoc.mjs prepare <dir> [--file name.html] [--title text] [--replace-assets] | validate <file> | describe [--tag rd-name]";
async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Node 24 or newer is required.");
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: "string" },
      title: { type: "string" },
      "replace-assets": { type: "boolean" },
      tag: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) return { ok: true, usage: HELP };
  const [command, target, ...extra] = positionals;
  if (extra.length) throw new Error(HELP);
  const assetRoot = resolve(import.meta.dirname, "../assets");
  if (command === "prepare" && target && !values.tag)
    return prepare(assetRoot, target, {
      file: values.file,
      title: values.title,
      replaceAssets: values["replace-assets"],
    });
  if (command === "validate" && target && !Object.keys(values).length)
    return validate(target, assetRoot);
  if (
    command === "describe" &&
    !target &&
    Object.keys(values).every((k) => k === "tag")
  )
    return { ok: true, ...describe(values.tag) };
  throw new Error(HELP);
}
try {
  const result = await main();
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      code: "COMMAND_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
}
