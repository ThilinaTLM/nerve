import { getFilesystemLocations, type FilesystemLocations } from "$lib/api";

let cached: Promise<FilesystemLocations> | undefined;

/**
 * The daemon's places, drives, separator, home and casing. Static for the life
 * of a daemon connection, so it is fetched once and shared; a failed request is
 * not cached so the next caller retries.
 */
export function loadFilesystemLocations(): Promise<FilesystemLocations> {
  if (!cached) {
    const request = getFilesystemLocations();
    cached = request;
    request.catch(() => {
      if (cached === request) cached = undefined;
    });
  }
  return cached;
}
