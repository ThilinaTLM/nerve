// GENERATED from the method tables (sdk-dts.test.ts); regenerate with UPDATE_SDK_DTS=1.
// atlassian.d.ts: sandbox globals and the shapes they return.

interface AtlassianPerson {
  accountId: string;
  name: string;
  email?: string;
}
interface AtlassianDefaults {
  jira?: { site: string; project?: string; user: AtlassianPerson };
  confluence?: { site: string; space?: string; user: AtlassianPerson };
}

declare const atlassian: {
  /** Configured sites, default project/space and current user; only configured products appear. Cached per run. */
  defaults(): Promise<AtlassianDefaults>;
};
