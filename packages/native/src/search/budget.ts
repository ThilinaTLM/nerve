import type { SearchField, SearchUpdate } from "./contracts.js";

// Input/structure limits, not claims about allocator RSS. Mirrored in document.rs.
export const MAX_UNITS = 64 * 1024 * 1024;
export const MAX_DOCUMENTS = 200_000;
export const MAX_CHANGES = 400_000;
export const MAX_FIELDS = 400_000;
export const MAX_RECORDS = 2_000_000;
export const MAX_DOCUMENT_TEXT = 65536;
const keys = new Set(["path", "name", "title", "identifier", "description"]);
const nonAscii = /\P{ASCII}/u;
export interface UpdateBudget {
  units: number;
  changes: number;
  fields: number;
  records: number;
}

function fieldRecords(field: SearchField): number {
  let records = 1;
  if (field.key === "path") {
    let end = field.text.length;
    while (end && field.text.charCodeAt(end - 1) === 47) end--;
    records += 2; // At least one original + lowercase segment view.
    for (let i = 0; i < end; i++)
      if (field.text.charCodeAt(i) === 47) records += 2;
  }
  if (nonAscii.test(field.text))
    for (const char of field.text)
      if (char.length !== char.toLowerCase().length) records++; // Sparse casing span.
  return records;
}

/** Validate/count first; no captured document/field graph or casing strings yet. */
export function validateUpdate(input: SearchUpdate): UpdateBudget {
  if (
    !Array.isArray(input.upsert) ||
    !Array.isArray(input.remove) ||
    input.upsert.length > MAX_DOCUMENTS ||
    input.remove.length > MAX_DOCUMENTS
  )
    throw new RangeError("Search update document/removal count exceeds 200000");
  let fields = 0;
  // Headers first: reject huge arrays of empty fields without inspecting text getters.
  for (const document of input.upsert) {
    if (
      !document ||
      !Array.isArray(document.fields) ||
      !document.fields.length ||
      document.fields.length > 32
    )
      throw new TypeError("Invalid search document: requires 1 to 32 fields");
    fields += document.fields.length;
    if (fields > MAX_FIELDS)
      throw new RangeError("Search update field budget exceeds 400000");
  }
  let units = 0,
    records = input.upsert.length + input.remove.length;
  const ids = new Set<string>();
  for (const document of input.upsert) {
    if (
      typeof document.id !== "string" ||
      !document.id.length ||
      document.id.length > 1024 ||
      typeof document.kind !== "string" ||
      !document.kind.length ||
      document.kind.length > 128
    )
      throw new TypeError("Invalid search document identity/kind");
    if (ids.has(document.id))
      throw new TypeError("Duplicate search document id in update");
    ids.add(document.id);
    units += document.id.length + document.kind.length;
    let textUnits = 0;
    for (const field of document.fields) {
      if (
        !field ||
        !keys.has(field.key) ||
        typeof field.text !== "string" ||
        field.text.length > MAX_DOCUMENT_TEXT
      )
        throw new TypeError(
          "Invalid search field (maximum 65536 UTF-16 units)",
        );
      textUnits += field.text.length;
      if (textUnits > MAX_DOCUMENT_TEXT)
        throw new RangeError("Search document text exceeds 65536 UTF-16 units");
      units += field.text.length;
      records += fieldRecords(field);
      if (records > MAX_RECORDS)
        throw new RangeError(
          "Search update structural record budget exceeds 2000000",
        );
      if (units > MAX_UNITS)
        throw new RangeError("Search update source exceeds 64Mi UTF-16 units");
    }
    if (!textUnits)
      throw new TypeError("Invalid search document: needs a nonempty field");
  }
  for (const id of input.remove) {
    if (typeof id !== "string" || !id.length || id.length > 1024)
      throw new TypeError("Invalid search removal id");
    units += id.length;
    if (units > MAX_UNITS)
      throw new RangeError("Search update source exceeds 64Mi UTF-16 units");
  }
  return {
    units,
    changes: input.upsert.length + input.remove.length,
    fields,
    records,
  };
}

export function captureUpdate(input: SearchUpdate): SearchUpdate {
  return {
    upsert: input.upsert.map((document) => ({
      id: document.id,
      kind: document.kind,
      fields: document.fields.map((field) => ({
        key: field.key,
        text: field.text,
      })),
    })),
    remove: input.remove.slice(),
  };
}
