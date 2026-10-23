import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configurationJSONSchemas } from "../src/domains/agent-configuration/index.js";

const directory = resolve(
  process.argv[2] ??
    fileURLToPath(
      new URL("../dist/json-schema/agent-configuration/", import.meta.url),
    ),
);
await mkdir(directory, { recursive: true });
for (const [name, schema] of Object.entries(configurationJSONSchemas())) {
  await writeFile(
    join(directory, `${name}.schema.json`),
    `${JSON.stringify(schema, null, 2)}\n`,
  );
}
