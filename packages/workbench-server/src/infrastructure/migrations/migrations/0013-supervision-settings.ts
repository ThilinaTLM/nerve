import { defaultSettings, settingsSchema } from "@nervekit/contracts";
import { normalizeSettings } from "../../storage/settings-normalization.js";
import { defineCanonicalJsonMigration } from "../define-json-migration.js";

export const migration0013 = defineCanonicalJsonMigration({
  id: "0013-supervision-settings",
  version: 1,
  description: "Add canonical supervision permission settings",
  relativePath: "config.json",
  readDefault: () => defaultSettings,
  canonicalize: (value) => normalizeSettings(value).settings,
  verify: (value) => settingsSchema.parse(value),
});
