export function shouldRefreshSettings(event: { type: string }): boolean {
  return (
    event.type === "settings.updated" ||
    event.type === "applicationConfiguration.updated"
  );
}
