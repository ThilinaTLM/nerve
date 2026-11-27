import { files } from "@nervekit/native";

/** The native `files` API the server uses; the addon always ships it. */
export type NativeFilesApi = Pick<
  typeof files,
  "listDirectory" | "createPathIndex" | "searchContent"
>;
export type NativePathIndex = ReturnType<NativeFilesApi["createPathIndex"]>;

let override: NativeFilesApi | undefined;

export function nativeFiles(): NativeFilesApi {
  return override ?? files;
}

/** Test seam: pass `null` to restore the real addon. */
export function setNativeFilesForTesting(api: NativeFilesApi | null): void {
  override = api ?? undefined;
}
