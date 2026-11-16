import type { Platform, ReleaseAsset } from "../assets";

export type SourceReference = {
  repo: string;
  url: string;
  repositoryPath: string;
  provider: string;
};

export type Release = {
  tag_name?: string;
  name?: string;
  published_at?: string | null;
  body?: string | null;
  assets: ReleaseAsset[];
};

export type Provider = {
  id: string;
  match(url: URL): boolean;
  reference(url: URL): SourceReference;
  repoApiUrl(reference: SourceReference): string;
  releaseApiUrls(reference: SourceReference): string[];
  normalize(payload: unknown): Release;
  assetScore?(asset: ReleaseAsset, platform: Platform): number;
};