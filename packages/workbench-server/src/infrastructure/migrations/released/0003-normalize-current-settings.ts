import { defaultSettings, settingsSchema } from "@nervekit/contracts";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../storage/json.js";
import { normalizeSettings } from "../legacy/settings-normalization.js";
import type { StorageMigration } from "../migration.js";
import { migrationChecksum } from "../checksum.js";

export const migration0003: StorageMigration = {
  id: "0003-normalize-current-settings",
  description: "Normalize persisted settings to the current schema",
  checksum: migrationChecksum(
    "0003-normalize-current-settings|v1|Normalize persisted settings to the current schema",
  ),
  async detect(context) {
    if (!(await pathExists(context.paths.configPath))) return "pending";
    const raw = await readJsonFile<unknown>(context.paths.configPath);
    const parsed = settingsSchema.safeParse(raw);
    if (!parsed.success) return "pending";
    const normalized = normalizeSettings(raw);
    return normalized.changed ||
      JSON.stringify(raw) !== JSON.stringify(normalized.settings)
      ? "pending"
      : "current";
  },
  async backup() {
    return { paths: ["config.json"] };
  },
  async up(context) {
    const raw = (await pathExists(context.paths.configPath))
      ? await readJsonFile<unknown>(context.paths.configPath)
      : defaultSettings;
    const normalized = normalizeSettings(raw);
    await atomicWriteJson(context.paths.configPath, normalized.settings, 0o600);
  },
  async verify(context) {
    settingsSchema.parse(await readJsonFile(context.paths.configPath));
  },
};
