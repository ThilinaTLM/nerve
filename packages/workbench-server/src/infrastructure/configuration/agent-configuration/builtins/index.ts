import { planning } from "./planning.js";
import { coding } from "./coding.js";
import { lead } from "./lead.js";
import { explore } from "./explore.js";
import { developer } from "./developer.js";

/**
 * Built-in agent profiles, one module per profile. User and project profile
 * files with the same name shadow these.
 *
 * Each definition is serialized once and digests bind those exact bytes, so
 * changing a definition (including its key order) changes its digest.
 */
const definitions = [planning, coding, lead, explore, developer];

export const bundledAgentProfiles: Readonly<Record<string, string>> =
  Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      JSON.stringify(definition),
    ]),
  );
