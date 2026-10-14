import type { HtmlPreviewApproval } from "../../../presentation/files/html-preview-message.js";
import { htmlPreviewResourceCandidate } from "../../../presentation/files/html-preview-message.js";
import type { HtmlPreviewViewModel } from "../../../presentation/files/file-pane-contracts.js";
import {
  htmlPreviewCreateResponseSchema,
  type HtmlPreviewCreateRequest,
  type HtmlPreviewCreateResponse,
} from "@nervekit/contracts/filesystem";

export type HtmlPreviewSource = Omit<HtmlPreviewCreateRequest, "approvals"> & {
  key: string;
};

type State = HtmlPreviewViewModel & { pending?: HtmlPreviewApproval };
const permissionKey = (permission: HtmlPreviewApproval) =>
  `${permission.category}:${permission.origin}`;

/** Owns one transient activation. All asynchronous results are generation-scoped. */
export function createHtmlPreviewController(deps: {
  create: (
    request: HtmlPreviewCreateRequest,
  ) => Promise<HtmlPreviewCreateResponse>;
  revoke: (id: string) => Promise<void>;
  changed: (state: State) => void;
}) {
  let source: HtmlPreviewSource | undefined;
  let generation = 0;
  let session: HtmlPreviewCreateResponse | undefined;
  let state: State = {};
  let approvals: HtmlPreviewApproval[] = [];
  let denied = new Set<string>();
  let queue: HtmlPreviewApproval[] = [];
  const emit = () => deps.changed({ ...state });
  const revoke = (id: string) => {
    void deps.revoke(id).catch(() => {});
  };
  function release() {
    if (session) revoke(session.id);
    session = undefined;
  }
  async function load() {
    const current = source;
    if (!current) return;
    const version = ++generation;
    release();
    state = {
      loading: true,
      blocked: denied.size > 0 || queue.length > 0,
      pending: queue[0],
    };
    emit();
    try {
      const created = await deps.create({
        projectId: current.projectId,
        path: current.path,
        text: current.text,
        approvals: [...approvals],
      });
      if (version !== generation) {
        revoke(created.id);
        return;
      }
      // Never let a malformed API response turn the iframe into an arbitrary URL.
      if (
        !htmlPreviewCreateResponseSchema.safeParse(created).success ||
        created.url !== `/html-preview/${created.id}/document`
      ) {
        revoke(created.id);
        throw new Error("Invalid HTML preview capability response.");
      }
      session = created;
      state = { ...state, loading: false, url: created.url };
    } catch (error) {
      if (version !== generation) return;
      state = {
        ...state,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not create HTML preview.",
      };
    }
    emit();
  }
  function activate(next?: HtmlPreviewSource) {
    if (
      source?.key === next?.key &&
      source?.projectId === next?.projectId &&
      source?.path === next?.path &&
      source?.text === next?.text
    )
      return;
    ++generation;
    release();
    source = next;
    approvals = [];
    denied = new Set();
    queue = [];
    state = {};
    emit();
    if (source) void load();
  }
  return {
    activate,
    dispose() {
      activate(undefined);
    },
    resource(data: unknown, appOrigin: string) {
      if (!source || !session) return;
      const candidate = htmlPreviewResourceCandidate(data, appOrigin);
      if (!candidate) return;
      const key = permissionKey(candidate);
      if (
        approvals.some((item) => permissionKey(item) === key) ||
        denied.has(key) ||
        queue.some((item) => permissionKey(item) === key)
      )
        return;
      // Bound untrusted document-driven prompt and memory growth.
      if (queue.length + denied.size + approvals.length >= 64) return;
      queue.push(candidate);
      state = { ...state, blocked: true, pending: queue[0] };
      emit();
    },
    decide(allow: boolean, expected?: HtmlPreviewApproval) {
      if (expected && queue[0] !== expected) return;
      const candidate = queue.shift();
      if (!candidate) return;
      if (allow) approvals.push(candidate);
      else denied.add(permissionKey(candidate));
      state = { ...state, pending: queue[0] };
      if (allow) void load();
      else emit();
    },
    retry() {
      denied.clear();
      queue = [];
      void load();
    },
  };
}
