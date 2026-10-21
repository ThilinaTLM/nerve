export type ProfileSettingsTarget = {
  scope: "user" | "project";
  projectId?: string;
};
export type ProfileSettingsSnapshot = {
  target: ProfileSettingsTarget;
  generation: number;
  digest: string | null;
};

/** Navigation invalidates completions, even when returning to the original target. */
export class ProfileSettingsSession {
  private target: ProfileSettingsTarget | undefined;
  private generation = 0;

  navigate(target: ProfileSettingsTarget): boolean {
    if (
      this.target?.scope === target.scope &&
      this.target.projectId === target.projectId
    )
      return false;
    this.target = { ...target };
    this.generation += 1;
    return true;
  }

  capture(
    target: ProfileSettingsTarget,
    digest: string | null,
  ): ProfileSettingsSnapshot {
    this.navigate(target);
    return { target: { ...target }, generation: this.generation, digest };
  }

  isCurrent(snapshot: ProfileSettingsSnapshot): boolean {
    return (
      snapshot.generation === this.generation &&
      snapshot.target.scope === this.target?.scope &&
      snapshot.target.projectId === this.target?.projectId
    );
  }
}
