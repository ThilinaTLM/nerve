import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { providerCatalogSchema } from "@nervekit/contracts";
import { atomicWriteJson, readJsonFile } from "../../storage/json.js";
import type { LegacyPortableState } from "./legacy-portable-state.js";

export const LEGACY_IMPORT_ENVELOPE_PATH =
  "migrations/staging/legacy-portable-state.json";
export const LEGACY_IMPORT_MARKER_PATH =
  "migrations/.legacy-portable-import-v1.json";

const credentialSchema = z.object({
  name: z.string().regex(/^provider:.+:(?:apiKey|oauth)$/),
  value: z.string(),
});

export const legacyImportEnvelopeSchema = z
  .object({
    format: z.literal("nerve-legacy-portable-state"),
    version: z.literal(1),
    settings: z.record(z.string(), z.unknown()).optional(),
    providerCatalog: providerCatalogSchema.optional(),
    credentials: z.array(credentialSchema),
    credentialStatus: z.enum(["read", "failed"]),
  })
  .superRefine((value, context) => {
    const names = new Set<string>();
    for (const [index, credential] of value.credentials.entries()) {
      if (names.has(credential.name)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate credential '${credential.name}'.`,
          path: ["credentials", index, "name"],
        });
      }
      names.add(credential.name);
    }
  });

export type LegacyImportEnvelope = z.infer<typeof legacyImportEnvelopeSchema>;

export interface LegacyImportMarker {
  importedAt: string;
  settingsStatus: "imported" | "none";
  providerCatalogStatus: "imported" | "none";
  importedCustomProviderCount: number;
  importedCustomModelCount: number;
  importedCredentialCount: number;
  credentialStatus: "imported" | "none" | "failed";
}

export function legacyImportEnvelopePath(home: string): string {
  return join(home, ...LEGACY_IMPORT_ENVELOPE_PATH.split("/"));
}

export function legacyImportMarkerPath(home: string): string {
  return join(home, ...LEGACY_IMPORT_MARKER_PATH.split("/"));
}

export async function writeLegacyImportEnvelope(
  home: string,
  portable: LegacyPortableState,
): Promise<void> {
  const path = legacyImportEnvelopePath(home);
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  const envelope = legacyImportEnvelopeSchema.parse({
    format: "nerve-legacy-portable-state",
    version: 1,
    settings: portable.settings,
    providerCatalog: portable.providerCatalog,
    credentials: portable.credentials.map(([name, value]) => ({ name, value })),
    credentialStatus: portable.credentialStatus,
  });
  await atomicWriteJson(path, envelope, 0o600);
}

export async function readLegacyImportEnvelope(
  home: string,
): Promise<LegacyImportEnvelope> {
  return legacyImportEnvelopeSchema.parse(
    await readJsonFile<unknown>(legacyImportEnvelopePath(home)),
  );
}
