import { defaultSettings, settingsSchema } from "@nervekit/contracts";
import { normalizeSettings } from "../legacy/settings-normalization.js";
import { defineCanonicalJsonMigration } from "../define-json-migration.js";

export const migration0013 = defineCanonicalJsonMigration({
  id: "0013-permission-settings",
  version: 1,
  description: "Add canonical permission exception settings",
  relativePath: "config.json",
  readDefault: () => defaultSettings,
  canonicalize: (value) => normalizeSettings(value).settings,
  verify: (value) => settingsSchema.parse(value),
});
