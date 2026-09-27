export interface MigrationFileV1 {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

/** File access is rooted by the runner; relative paths cannot escape the home. */
export interface MigrationFilesV1 {
  read(relativePath: string): Promise<Uint8Array | undefined>;
  list(relativeDirectory: string): Promise<readonly string[]>;
  /** Creates a staged path. Existing different content is a migration error. */
  create(relativePath: string, bytes: Uint8Array): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  sha256(bytes: Uint8Array): Promise<string>;
}
