export const COMPONENTS_PATH = "/dev/components";
export const WIREFRAMES_PATH = "/dev/wireframes";

export type LabRoute =
  | { page: "components" }
  | { page: "wireframes"; name?: string };

export function labRouteFromPath(pathname: string): LabRoute | undefined {
  const path = pathname.replace(/\/$/, "");
  if (path === COMPONENTS_PATH) return { page: "components" };
  if (path === WIREFRAMES_PATH) return { page: "wireframes" };
  if (path.startsWith(`${WIREFRAMES_PATH}/`)) {
    const name = path.slice(WIREFRAMES_PATH.length + 1);
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      return { page: "wireframes", name };
    }
  }
  return undefined;
}

/** Reads the selected catalog section from a `#/<id>` hash. */
export function sectionIdFromHash(hash: string): string | undefined {
  const id = hash.replace(/^#\/?/, "").trim();
  return id || undefined;
}

export function hashForSection(id: string): string {
  return `#/${id}`;
}
