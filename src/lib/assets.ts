export type Platform = { os: string; arch: string };
export type Architecture = "auto" | "x86_64" | "aarch64" | "x86" | "arm";
export type ReleaseAsset = { name: string; browser_download_url: string; sha256?: string | null };

export const formats: Record<string, string[]> = {
  windows: [".msi", ".exe"],
  macos: [".dmg", ".pkg"],
  linux: [".appimage", ".deb", ".rpm"],
};

export const archAliases: Record<string, string[]> = {
  x86_64: ["x86_64", "amd64", "x64"],
  aarch64: ["aarch64", "arm64", "armv8"],
  x86: ["i386", "i686", "x86"],
  arm: ["armv7", "armhf", "arm"],
};

/**
 * OS marker fragments that positively identify the platform in an asset
 * filename, so extensionless executables can be recognized automatically.
 */
const osKeywordSets: Record<string, string[]> = {
  linux: ["linux"],
  macos: ["macos", "darwin", "osx", "mac"],
  windows: ["windows", "win32", "win64", "win"],
};

/** Matches "universal" binary names that support any architecture. */
const universalPattern = /(^|[^a-z0-9])universal2?($|[^a-z0-9_])/i;

const allArchitectureAliases = Object.values(archAliases).flat();

function wordBoundaryRegExp(fragments: string[]): RegExp {
  return new RegExp(`(^|[^a-z0-9])(?:${fragments.join("|")})($|[^a-z0-9_])`, "i");
}

function mentions(name: string, fragments: string[]): string[] {
  return fragments.filter((fragment) =>
    wordBoundaryRegExp([fragment]).test(name),
  );
}

/**
 * Whether an asset name is compatible with the target architecture: either it
 * names the architecture (or a universal build) or it does not name one at all.
 */
function architectureMatches(name: string, aliases: string[]): boolean {
  const architectureMentions = mentions(name, allArchitectureAliases);
  return (
    !architectureMentions.length ||
    aliases.some((alias) => architectureMentions.includes(alias)) ||
    universalPattern.test(name)
  );
}

/**
 * Picks the release asset whose native installer format matches this platform.
 * When no asset with a known format exists, falls back to extensionless
 * executables whose filename identifies this OS (such as
 * "frankenphp-linux-x86_64"). Assets naming another OS, contradicting the
 * device architecture, or carrying an extension from another platform are
 * never auto-selected.
 */
export function assetForPlatform(assets: ReleaseAsset[], platform: Platform): ReleaseAsset | undefined {
  const extensions = formats[platform.os];
  if (!extensions) return undefined;
  const aliases = archAliases[platform.arch] ?? [platform.arch];

  const extensionCandidates = assets.flatMap((asset) => {
    const name = asset.name.toLowerCase();
    const extensionRank = extensions.findIndex((extension) => name.endsWith(extension));
    if (extensionRank < 0) return [];
    return architectureMatches(name, aliases)
      ? [{ asset, extensionRank, specificity: mentions(name, allArchitectureAliases).length ? 0 : 1 }]
      : [];
  });
  if (extensionCandidates.length) {
    extensionCandidates.sort(
      (left, right) =>
        left.extensionRank - right.extensionRank || left.specificity - right.specificity,
    );
    return extensionCandidates[0].asset;
  }

  const platformKeyword = wordBoundaryRegExp(osKeywordSets[platform.os] ?? []);
  const foreignKeyword = wordBoundaryRegExp(
    Object.entries(osKeywordSets)
      .filter(([os]) => os !== platform.os)
      .flatMap(([, fragments]) => fragments),
  );
  const keywordCandidates = assets.flatMap((asset) => {
    const name = asset.name.toLowerCase();
    if (!platformKeyword.test(name) || foreignKeyword.test(name)) return [];
    if (!architectureMatches(name, aliases)) return [];
    return [{ asset, specificity: mentions(name, allArchitectureAliases).length ? 0 : 1 }];
  });
  if (keywordCandidates.length) {
    keywordCandidates.sort((left, right) => left.specificity - right.specificity);
    return keywordCandidates[0].asset;
  }

  const loneAsset = assets.length === 1 ? assets[0] : undefined;
  if (
    loneAsset &&
    !/\.[^./]+$/.test(loneAsset.name) &&
    architectureMatches(loneAsset.name.toLowerCase(), aliases) &&
    !foreignKeyword.test(loneAsset.name.toLowerCase())
  ) {
    return loneAsset;
  }
  return undefined;
}

/**
 * Picks the release asset matching an explicitly chosen file extension and
 * architecture. Assets naming an incompatible architecture stay rejected;
 * naming another OS is the user's explicit choice and is not filtered here.
 */
export function assetForExtension(
  assets: ReleaseAsset[],
  extension: string,
  architecture: Architecture,
  platform?: Platform | null,
): ReleaseAsset | undefined {
  const normalizedExtension = extension.toLowerCase();
  const selectedArchitecture = architecture === "auto" ? platform?.arch : architecture;
  const aliases = selectedArchitecture
    ? archAliases[selectedArchitecture] ?? [selectedArchitecture]
    : [];
  const candidates = assets.flatMap((asset) => {
    const name = asset.name.toLowerCase();
    if (!name.endsWith(normalizedExtension)) return [];
    const architectureMentions = mentions(name, allArchitectureAliases);
    const matchesArchitecture = aliases.some((alias) => architectureMentions.includes(alias));
    const universal = universalPattern.test(name);
    if (architectureMentions.length && !matchesArchitecture && !universal) return [];
    return [{ asset, specificity: matchesArchitecture ? 0 : universal ? 1 : 2 }];
  });
  candidates.sort((left, right) => left.specificity - right.specificity);
  return candidates[0]?.asset;
}
