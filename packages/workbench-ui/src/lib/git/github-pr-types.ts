import type { GithubPrDetail } from "@nervekit/contracts";

export type GithubPrViewState = {
  id: string;
  repo: string;
  number: number;
  detail?: GithubPrDetail;
  loading: boolean;
  error?: string;
};

export type PrViewState = GithubPrViewState;
