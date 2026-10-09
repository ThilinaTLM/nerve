import type { MigrationStepKindV1 } from "../kit/define-step/v1.js";

export type StorageMigrationStage = "draft" | "final" | "released";

export interface StorageMigrationRegistryMetadata {
  readonly id: string;
  readonly ordinal: number;
  readonly kind: MigrationStepKindV1;
  readonly checksum: string;
  readonly stage: StorageMigrationStage;
  readonly acceptedChecksums: readonly string[];
  /** Legacy raw-SQL checksums used only while adopting pre-framework ledgers. */
  readonly legacyAdoptionChecksums?: readonly string[];
}

/**
 * Generated from migrations.lock.json by the release lifecycle tooling.
 * The JSON lock remains the tooling/review authority.
 */
export const STORAGE_MIGRATION_REGISTRY_METADATA = [
  {
    id: "0001-nerve-home-v1",
    ordinal: 1,
    kind: "schema",
    checksum:
      "d0da686516897b712472427cf8e7010e2408239caf8e8300ec3ddbe9cfd18262",
    stage: "released",
    acceptedChecksums: [],
    legacyAdoptionChecksums: [
      "f9dc1e603a8e1adbd9254471ae6e096ca92399edc0d2117933ad62850de2ad39",
    ],
  },
  {
    id: "0002-atomic-run-lifecycle-work",
    ordinal: 2,
    kind: "schema",
    checksum:
      "6cc2bb52a210d66abdb04390b7269d6ba110a98f6c6d1c78c369f71e036ab064",
    stage: "released",
    acceptedChecksums: [],
    legacyAdoptionChecksums: [
      "cad065565ceacee71bbc5a34193d75cc32eabf02f5d2781ba23931c41a216156",
    ],
  },
  {
    id: "0003-authoritative-run-lifecycle",
    ordinal: 3,
    kind: "schema",
    checksum:
      "a8666a5e1a0fead638fe11477b55c40974987c8f8c89949404181ef417000e5b",
    stage: "released",
    acceptedChecksums: [],
    legacyAdoptionChecksums: [
      "903cc4597ae995ce01312150eb0168e8b4e2313f833b160fd2015bea273d1fe5",
    ],
  },
  {
    id: "0004-convert-run-lifecycle",
    ordinal: 4,
    kind: "schema",
    checksum:
      "936d7fa2d4ceff635c716180c4f0b911933b2870d419c2d2e014c90058aa701e",
    stage: "released",
    acceptedChecksums: [],
    legacyAdoptionChecksums: [
      "496cd5027ff354aee6aed213f19bb6c6771d5c847cc799d85e1cc4fd5781b28a",
    ],
  },
  {
    id: "0005-async-subagent-completions",
    ordinal: 5,
    kind: "schema",
    checksum:
      "db5718b27b138a3d65bff588e99a71a583dc3c8959b4cfda4a814e88272e4164",
    stage: "released",
    acceptedChecksums: [],
    legacyAdoptionChecksums: [
      "e5a8afe2e1e8e3ca3c5447a89842f13f74b2d53018dc87ed3142e80c7d44e8e1",
    ],
  },
  {
    id: "0006-explore-agent-names",
    ordinal: 6,
    kind: "schema",
    checksum:
      "37e11647467095bb1a041add6de6eac73f5ad4b833ceb65f2c2ceaa15d6302ee",
    stage: "released",
    acceptedChecksums: [],
    legacyAdoptionChecksums: [
      "528f1bee3430ce1cd1159e9f42656ff5f8ef7f41033477058f85cdf8b24398f4",
    ],
  },
  {
    id: "0007-agent-async-obligations",
    ordinal: 7,
    kind: "schema",
    checksum:
      "2aded6ed904895a3b4fd92aa9711e6b9303a980209d99bf6af4410e5116026e8",
    stage: "released",
    acceptedChecksums: [],
    legacyAdoptionChecksums: [
      "6155dbcfcb6479fd5e223909fca39ecfd157a8eef2afdf793bf883b09e0e0c57",
    ],
  },
  {
    id: "0008-tool-result-payload-reference",
    ordinal: 8,
    kind: "files",
    checksum:
      "5f3365c02b33f177346ee716c7855248ff1fd668e50fe3839671641c1605d33e",
    stage: "released",
    acceptedChecksums: [],
  },
  {
    id: "0009-agent-async-obligations-backfill",
    ordinal: 9,
    kind: "data",
    checksum:
      "cb865a299879b725ec6d323612b36e7231c40800a4a42ae11f07370c267f5b6d",
    stage: "released",
    acceptedChecksums: [],
  },
  {
    id: "0010-deletion-indexes",
    ordinal: 10,
    kind: "schema",
    checksum:
      "ae373fd2dccfb7ef1ca810c7c147fd7e943bf1cc81051465cac47b562ec9d417",
    stage: "released",
    acceptedChecksums: [],
  },
  {
    id: "0011-agent-intervention-obligations",
    ordinal: 11,
    kind: "schema",
    checksum:
      "da3a1d582f647a3eec9bdbaaea2f47730e147db3cc896db3adf863241bc759af",
    stage: "final",
    acceptedChecksums: [],
  },
  {
    id: "0012-run-initial-input-lookup",
    ordinal: 12,
    kind: "schema",
    checksum:
      "047750dbcd657ee01c90fcbb2ea7e5bb5bf4df9908da889ba955bf0fd48c35d0",
    stage: "final",
    acceptedChecksums: [],
  },
] as const satisfies readonly StorageMigrationRegistryMetadata[];
