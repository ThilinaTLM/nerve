/** null means no remote-ref evidence; [] means refs changed but the branch is unknown. */
export function remoteRefBranches(paths: readonly string[]): string[] | null {
  const remotePaths = paths
    .map((path) => path.replaceAll("\\", "/"))
    .filter(
      (path) =>
        /(?:^|\/)refs\/remotes(?:\/|$)|(?:^|\/)packed-refs$/.test(path) &&
        !path.endsWith(".lock"),
    );
  if (!remotePaths.length) return null;
  return [
    ...new Set(
      remotePaths.flatMap((path) => {
        const match = /(?:^|\/)refs\/remotes\/[^/]+\/(.+)$/.exec(path);
        return match && match[1] !== "HEAD" ? [match[1]] : [];
      }),
    ),
  ];
}
