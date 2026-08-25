import { legacyConfigPath } from "../import/legacy-paths.js";
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
    if (!(await pathExists(legacyConfigPath(context.paths.home))))
      return "pending";
    const raw = await readJsonFile<unknown>(
      legacyConfigPath(context.paths.home),
    );
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
    const raw = (await pathExists(legacyConfigPath(context.paths.home)))
      ? await readJsonFile<unknown>(legacyConfigPath(context.paths.home))
      : defaultSettings;
    const normalized = normalizeSettings(raw);
    await atomicWriteJson(
      legacyConfigPath(context.paths.home),
      normalized.settings,
      0o600,
    );
  },
  async verify(context) {
    settingsSchema.parse(
      await readJsonFile(legacyConfigPath(context.paths.home)),
    );
  },
};
