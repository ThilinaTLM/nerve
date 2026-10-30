import assert from "node:assert/strict";
type Data = Record<string, unknown>;
const object = (value: unknown): value is Data =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Only profile-owned fields: ordinary settings retain their source defaults. */
export function convertProfileDocument(value: unknown): unknown {
  const result = structuredClone(value);
  assert(object(result), "Expected a profile document");
  if (Object.hasOwn(result, "description")) {
    assert(
      !Object.hasOwn(result, "whenToUse") ||
        result.whenToUse === result.description,
      "Conflicting profile when-to-use fields",
    );
    result.whenToUse = result.description;
    delete result.description;
  }
  dropProfileDefaults(result);
  return result;
}
function dropProfileDefaults(profile: Data): void {
  for (const section of ["recommendations", "requirements"]) {
    const contribution = structuredClone(profile[section]);
    if (!object(contribution) || !object(contribution.skills)) continue;
    profile[section] = contribution;
    delete contribution.skills.defaults;
    if (!Object.keys(contribution.skills).length) delete contribution.skills;
  }
}
