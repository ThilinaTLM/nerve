/**
 * What the Extensions page offers its page header: one Reload that re-reads
 * the installed extensions from disk. The page registers the action while it
 * is open; the header button lives in the settings shell.
 */
export class ExtensionsPageController {
  reload = $state.raw<(() => Promise<unknown>) | undefined>();
  busy = $state(false);

  async run(): Promise<void> {
    if (!this.reload || this.busy) return;
    this.busy = true;
    try {
      await this.reload();
    } finally {
      this.busy = false;
    }
  }
}
