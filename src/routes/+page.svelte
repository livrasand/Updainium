<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { fly } from "svelte/transition";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
  import { openPath } from "@tauri-apps/plugin-opener";
  import Button from "@smui/button";
  import Card from "@smui/card";

  type Platform = { os: string; arch: string };
  type Architecture = "auto" | "x86_64" | "aarch64" | "x86" | "arm";
  type ReleaseAsset = { name: string; browser_download_url: string; sha256?: string | null };
  type Release = {
    tag_name?: string;
    name?: string;
    published_at?: string;
    assets: ReleaseAsset[];
  };
  type SourceReference = { repo: string; url: string; repositoryPath: string; provider: string };
  type DownloadPhase = "downloading" | "verifying" | "opening";
  type DownloadProgressEvent = {
    downloadId: string;
    phase: DownloadPhase;
    received: number;
    total: number | null;
  };
  type TrackedSource = {
    id: string;
    repo: string;
    url: string;
    appIdentifier?: string;
    assetExtension?: string;
    assetArchitecture?: Architecture;
    version: string;
    releaseDate?: string;
    assetName: string;
    assetUrl: string;
    checkedAt: string;
    error: string;
    iconUrl?: string;
    downloadPath?: string;
    sha256?: string;
    downloadedSha256?: string;
    hashVerified?: boolean;
    lastKnownInstalledVersion?: string;
    installedVersionSource?: "detected" | "manual";
  };

  const storageKey = "updainium.sources.v1";
  const architectures: { value: Architecture; label: string }[] = [
    { value: "auto", label: "Automatic (this device)" },
    { value: "x86_64", label: "x86_64 / AMD64 (Intel 64-bit)" },
    { value: "aarch64", label: "aarch64 / ARM64 (Apple Silicon)" },
    { value: "x86", label: "x86 / i686 (Intel 32-bit)" },
    { value: "arm", label: "ARMv7 / ARMHF (ARM 32-bit)" },
  ];
  const archAliases: Record<string, string[]> = {
    x86_64: ["x86_64", "amd64", "x64"],
    aarch64: ["aarch64", "arm64", "armv8"],
    x86: ["i386", "i686", "x86"],
    arm: ["armv7", "armhf", "arm"],
  };
  const formats: Record<string, string[]> = {
    windows: [".msi", ".exe"],
    macos: [".dmg", ".pkg"],
    linux: [".appimage", ".deb", ".rpm"],
  };
  const osLabels: Record<string, string> = {
    windows: "Windows",
    macos: "macOS",
    linux: "Linux",
  };

  let sources = $state<TrackedSource[]>([]);
  let platform = $state<Platform | null>(null);
  let ready = $state(false);
  let storageError = $state("");
  let appError = $state("");
  let filter = $state("");
  let showAddSection = $state(false);
  let selectedSourceId = $state<string | null>(null);
  let editingSourceId = $state<string | null>(null);
  let sourceUrl = $state("");
  let sourceAppIdentifier = $state("");
  let sourceExtension = $state("");
  let sourceArchitecture = $state<Architecture>("auto");
  let formError = $state("");
  let adding = $state(false);
  let identifyingAppIdentifier = $state(false);
  let appFileDragOver = $state(false);
  let checking = $state<string[]>([]);
  let downloading = $state<string | null>(null);
  let uninstalling = $state<string | null>(null);
  let downloadProgress = $state<DownloadProgressEvent | null>(null);
  let installedVersions = $state<Record<string, string | null | undefined>>({});
  let installedCheckErrors = $state<string[]>([]);
  let snackbarMessage = $state("");
  let snackbarOpen = $state(false);
  let snackbarTimer: ReturnType<typeof setTimeout> | undefined;

  const visibleSources = $derived(
    sources.filter((source) => source.repo.toLowerCase().includes(filter.trim().toLowerCase())),
  );
  const selectedSource = $derived(sources.find((source) => source.id === selectedSourceId));
  const platformName = $derived(
    platform
      ? `${platform.os === "macos" ? "macOS" : platform.os} · ${platform.arch}`
      : "Detecting system",
  );
  // Percentage only when the server published a content length; anything else
  // gets an indeterminate bar instead of a made-up number.
  const downloadPercent = $derived.by(() => {
    if (!downloadProgress) return null;
    if (downloadProgress.phase !== "downloading") return 100;
    if (downloadProgress.total && downloadProgress.total > 0) {
      return Math.min(100, Math.round((downloadProgress.received / downloadProgress.total) * 100));
    }
    return null;
  });
  const downloadStatusLabel = $derived(
    downloadProgress?.phase === "verifying"
      ? "Verifying the SHA-256 checksum…"
      : downloadProgress?.phase === "opening"
        ? "Opening the installer…"
        : downloadPercent !== null
          ? "Downloading"
          : "Downloading…",
  );
  const downloadDetailLabel = $derived.by(() => {
    if (!downloadProgress) return "";
    if (downloadProgress.phase === "verifying") {
      return "The download finished; checking the file against the published checksum.";
    }
    if (downloadProgress.phase === "opening") {
      return "The installer is ready and will now be opened.";
    }
    const received = formatBytes(downloadProgress.received);
    return downloadProgress.total && downloadProgress.total > 0
      ? `${received} of ${formatBytes(downloadProgress.total)}`
      : `${received} downloaded · total size unknown`;
  });

  onMount(async () => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (
          !Array.isArray(parsed) ||
          !parsed.every(
            (source) =>
              source &&
              typeof source.id === "string" &&
              typeof source.repo === "string" &&
              typeof source.url === "string" &&
              (source.appIdentifier === undefined || typeof source.appIdentifier === "string") &&
              typeof source.version === "string" &&
              (source.releaseDate === undefined || typeof source.releaseDate === "string") &&
              typeof source.assetName === "string" &&
              typeof source.assetUrl === "string" &&
              typeof source.checkedAt === "string" &&
              typeof source.error === "string" &&
              (source.lastKnownInstalledVersion === undefined || typeof source.lastKnownInstalledVersion === "string") &&
              (source.installedVersionSource === undefined || source.installedVersionSource === "detected" || source.installedVersionSource === "manual") &&
              (source.sha256 === undefined || typeof source.sha256 === "string") &&
              (source.downloadedSha256 === undefined || typeof source.downloadedSha256 === "string") &&
              (source.hashVerified === undefined || typeof source.hashVerified === "boolean") &&
              (source.assetArchitecture === undefined ||
                architectures.some((architecture) => architecture.value === source.assetArchitecture)) &&
              (source.iconUrl === undefined || typeof source.iconUrl === "string"),
          )
        ) {
          throw new Error("The saved catalog is not in a valid format.");
        }
        sources = parsed;
      }
    } catch (error) {
      appError = `Could not load the local catalog: ${messageOf(error)}`;
    }

    try {
      platform = await invoke<Platform>("get_platform");
    } catch (error) {
      appError = `Could not detect the system: ${messageOf(error)}`;
    }
    ready = true;
    if (platform) {
      await Promise.all([
        ...sources.map((source) => checkSource(source.id)),
        ...sources.map((source) => checkInstalled(source)),
      ]);
    }
  });

  onMount(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!showAddSection) return;
        if (event.payload.type === "over" || event.payload.type === "enter") {
          appFileDragOver = true;
        } else if (event.payload.type === "leave") {
          appFileDragOver = false;
        } else if (event.payload.type === "drop") {
          appFileDragOver = false;
          const path = event.payload.paths[0];
          if (path) void identifyAppFromPath(path);
        }
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  });

  $effect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(sources));
      storageError = "";
    } catch (error) {
      storageError = `Could not save the local catalog: ${messageOf(error)}`;
    }
  });

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function formatBytes(value: number): string {
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} kB`;
    return `${value} B`;
  }

  function repositoryFromUrl(input: string): SourceReference {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new Error("Enter a valid URL.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("The source must use a valid HTTPS URL.");
    }
    const hostname = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    let provider = "gitea";
    let repositoryParts = parts;

    if (hostname === "github.com") {
      provider = "github";
      repositoryParts = parts.slice(0, 2);
    } else {
      const gitlabMarker = parts.indexOf("-");
      if (hostname === "gitlab.com" || gitlabMarker >= 2) {
        provider = "gitlab";
        repositoryParts = gitlabMarker >= 2 ? parts.slice(0, gitlabMarker) : parts;
      } else {
        const releasesMarker = parts.indexOf("releases");
        if (releasesMarker >= 2) repositoryParts = parts.slice(0, releasesMarker);
      }
    }

    if (repositoryParts.length < 2) {
      throw new Error("The URL must point to a public repository.");
    }
    const repositoryPath = repositoryParts.join("/").replace(/\.git$/i, "");
    const url = new URL(`/${repositoryPath}`, parsed.origin).toString().replace(/\/$/, "");
    return { repo: `${hostname}/${repositoryPath}`, url, repositoryPath, provider };
  }

  function assetForPlatform(assets: ReleaseAsset[]): ReleaseAsset | undefined {
    if (!platform) return undefined;
    const extensions = formats[platform.os];
    if (!extensions) return undefined;
    const aliases = archAliases[platform.arch] ?? [platform.arch];
    const allAliases = Object.values(archAliases).flat();
    const candidates = assets.flatMap((asset) => {
      const name = asset.name.toLowerCase();
      const extensionRank = extensions.findIndex((extension) => name.endsWith(extension));
      if (extensionRank < 0) return [];
      const hasArchitecture = allAliases.some((alias) =>
        new RegExp(`(^|[^a-z0-9])${alias}($|[^a-z0-9_])`, "i").test(name),
      );
      const matchesArchitecture =
        !hasArchitecture ||
        aliases.some((alias) =>
          new RegExp(`(^|[^a-z0-9])${alias}($|[^a-z0-9_])`, "i").test(name),
        ) ||
        /(^|[^a-z0-9])universal2?($|[^a-z0-9_])/i.test(name);
      return matchesArchitecture ? [{ asset, extensionRank, specificity: hasArchitecture ? 0 : 1 }] : [];
    });
    candidates.sort(
      (left, right) =>
        left.extensionRank - right.extensionRank || left.specificity - right.specificity,
    );
    return candidates[0]?.asset;
  }

  function assetForExtension(
    assets: ReleaseAsset[],
    extension: string,
    architecture: Architecture,
  ): ReleaseAsset | undefined {
    const normalizedExtension = extension.toLowerCase();
    const selectedArchitecture = architecture === "auto" ? platform?.arch : architecture;
    const aliases = selectedArchitecture
      ? archAliases[selectedArchitecture] ?? [selectedArchitecture]
      : [];
    const allAliases = Object.values(archAliases).flat();
    const candidates = assets.flatMap((asset) => {
      const name = asset.name.toLowerCase();
      if (!name.endsWith(normalizedExtension)) return [];
      const hasArchitecture = allAliases.some((alias) =>
        new RegExp(`(^|[^a-z0-9])${alias}($|[^a-z0-9_])`, "i").test(name),
      );
      const matchesArchitecture = aliases.some((alias) =>
        new RegExp(`(^|[^a-z0-9])${alias}($|[^a-z0-9_])`, "i").test(name),
      );
      const universal = /(^|[^a-z0-9])universal2?($|[^a-z0-9_])/i.test(name);
      if (hasArchitecture && !matchesArchitecture && !universal) return [];
      return [{ asset, specificity: matchesArchitecture ? 0 : universal ? 1 : 2 }];
    });
    candidates.sort((left, right) => left.specificity - right.specificity);
    return candidates[0]?.asset;
  }

  async function checkSource(id: string): Promise<void> {
    const source = sources.find((item) => item.id === id);
    if (!source || !platform || checking.includes(id)) return;
    checking = [...checking, id];
    try {
      const reference = repositoryFromUrl(source.url);
      const origin = new URL(reference.url).origin;
      const repositoryApiUrl =
        reference.provider === "github"
          ? `https://api.github.com/repos/${reference.repositoryPath}`
          : reference.provider === "gitlab"
            ? `${origin}/api/v4/projects/${encodeURIComponent(reference.repositoryPath)}`
            : `${origin}/api/v1/repos/${reference.repositoryPath.split("/").map(encodeURIComponent).join("/")}`;
      let iconUrl = source.iconUrl;
      if (!iconUrl) {
        try {
          iconUrl =
            (await invoke<string | null>("fetch_repository_icon", {
              apiUrl: repositoryApiUrl,
            })) ?? undefined;
          if (iconUrl) {
            sources = sources.map((item) =>
              item.id === id ? { ...item, iconUrl } : item,
            );
          }
        } catch {
        }
      }
      const apiUrls =
        reference.provider === "github"
          ? [`https://api.github.com/repos/${reference.repositoryPath}/releases/latest`]
          : reference.provider === "gitlab"
            ? [
                `${origin}/api/v4/projects/${encodeURIComponent(reference.repositoryPath)}/releases/permalink/latest`,
              ]
            : [
                `${origin}/api/v1/repos/${reference.repositoryPath.split("/").map(encodeURIComponent).join("/")}/releases/latest`,
                `${origin}/api/v3/repos/${reference.repositoryPath}/releases/latest`,
                `${origin}/api/v4/projects/${encodeURIComponent(reference.repositoryPath)}/releases/permalink/latest`,
              ];
      // Forge APIs do not send `Access-Control-Allow-Origin`, so requesting them
      // from the WebView fails with "Load failed" even when they are reachable.
      // The backend fetches instead, where no cross-origin policy applies.
      const release = await invoke<Release>("fetch_release_metadata", { apiUrls });
      const asset = source.assetExtension
        ? assetForExtension(
            release.assets ?? [],
            source.assetExtension,
            source.assetArchitecture ?? "auto",
          )
        : assetForPlatform(release.assets ?? []);
      if (!asset) {
        if (source.assetExtension) {
          const architecture = source.assetArchitecture ?? "auto";
          const architectureLabel =
            architectures.find((option) => option.value === architecture)?.label ??
            "this device";
          const availableExtensions = [
            ...new Set(
              (release.assets ?? [])
                .map((item) => (item.name.match(/\.[^./]+$/)?.[0] ?? "").toLowerCase())
                .filter(Boolean),
            ),
          ].sort();
          const availableLabel = availableExtensions.length
            ? ` This release offers: ${availableExtensions.join(", ")}.`
            : "";
          const osKey = platform?.os ?? "";
          const nativeFormat = formats[osKey]?.find((format) =>
            availableExtensions.includes(format),
          );
          const platformHint =
            osKey && nativeFormat && nativeFormat !== source.assetExtension.toLowerCase()
              ? ` On ${osLabels[osKey] ?? osKey}, this release ships ${nativeFormat}; try ${nativeFormat} instead.`
              : "";
          throw new Error(
            `No release asset ends with ${source.assetExtension} for ${architectureLabel}.${availableLabel}${platformHint}`,
          );
        }
        const supported = formats[platform.os]?.join(", ") ?? "no compatible formats";
        throw new Error(`No installer compatible with ${platform.os} ${platform.arch}. Supported formats: ${supported}.`);
      }
      sources = sources.map((item) =>
        item.id === id
          ? {
              ...item,
              version: release.tag_name || release.name || "Unversioned release",
              releaseDate: release.published_at,
              assetName: asset.name,
              assetUrl: asset.browser_download_url,
              sha256: asset.sha256 ?? undefined,
              checkedAt: new Date().toISOString(),
              error: "",
              iconUrl: iconUrl ?? item.iconUrl,
              downloadPath: undefined,
              downloadedSha256: undefined,
              hashVerified: undefined,
            }
          : item,
      );
    } catch (error) {
      sources = sources.map((item) =>
        item.id === id
          ? { ...item, checkedAt: new Date().toISOString(), error: messageOf(error) }
          : item,
      );
    } finally {
      checking = checking.filter((item) => item !== id);
    }
  }

  function editSource(source: TrackedSource): void {
    editingSourceId = source.id;
    sourceUrl = source.url;
    sourceAppIdentifier = source.appIdentifier ?? "";
    sourceExtension = source.assetExtension ?? "";
    sourceArchitecture = source.assetArchitecture ?? "auto";
    formError = "";
    showAddSection = true;
  }

  async function identifyAppIdentifier(): Promise<void> {
    formError = "";
    identifyingAppIdentifier = true;
    try {
      const repo = repositoryFromUrl(sourceUrl.trim());
      const appName = repo.repositoryPath.split("/").at(-1) ?? "";
      const identifier = await invoke<string | null>("identify_installed_app_identifier", {
        appName,
      });
      if (!identifier) {
        throw new Error("No unique installed app matched the repository name.");
      }
      sourceAppIdentifier = identifier;
    } catch (error) {
      formError = `Could not identify the app ID: ${messageOf(error)}`;
    } finally {
      identifyingAppIdentifier = false;
    }
  }

  async function chooseAppFile(): Promise<void> {
    try {
      const path = await openFileDialog({
        multiple: false,
        directory: platform?.os === "macos",
        title: "Select the installed app",
      });
      if (typeof path === "string") await identifyAppFromPath(path);
    } catch (error) {
      formError = `Could not select the app file: ${messageOf(error)}`;
    }
  }

  async function identifyAppFromPath(path: string): Promise<void> {
    formError = "";
    identifyingAppIdentifier = true;
    try {
      sourceAppIdentifier = await invoke<string>("identify_app_identifier_from_path", { path });
    } catch (error) {
      formError = `Could not identify the app ID: ${messageOf(error)}`;
    } finally {
      identifyingAppIdentifier = false;
    }
  }

  async function saveSource(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    formError = "";
    adding = true;
    try {
      const currentSource = sources.find((source) => source.id === editingSourceId);
      const repo = repositoryFromUrl(sourceUrl.trim());
      const appIdentifier = sourceAppIdentifier.trim();
      const extensionInput = sourceExtension.trim();
      const extension = extensionInput
        ? extensionInput.startsWith(".")
          ? extensionInput
          : `.${extensionInput}`
        : "";
      if (
        (extension && !/^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/i.test(extension)) ||
        (!extension && (!editingSourceId || currentSource?.assetExtension))
      ) {
        throw new Error("Enter a valid file extension, such as .AppImage or .zip.");
      }
      if (
        sources.some(
          (source) =>
            source.id !== editingSourceId && source.url.toLowerCase() === repo.url.toLowerCase(),
        )
      ) {
        throw new Error("This repository is already in your catalog.");
      }
      const source: TrackedSource = {
        id: editingSourceId ?? crypto.randomUUID(),
        repo: repo.repo,
        url: repo.url,
        appIdentifier: appIdentifier || undefined,
        assetExtension: extension || undefined,
        assetArchitecture: sourceArchitecture,
        version: "",
        assetName: "",
        assetUrl: "",
        checkedAt: "",
        error: "",
        lastKnownInstalledVersion: currentSource?.url === repo.url ? currentSource.lastKnownInstalledVersion : undefined,
        installedVersionSource: currentSource?.url === repo.url ? currentSource.installedVersionSource : undefined,
      };
      if (editingSourceId) {
        const previousSource = sources.find((item) => item.id === editingSourceId);
        source.iconUrl = previousSource?.url === repo.url ? previousSource.iconUrl : undefined;
        sources = sources.map((item) => (item.id === editingSourceId ? source : item));
        selectedSourceId = editingSourceId;
      } else {
        sources = [source, ...sources];
      }
      const sourceId = source.id;
      editingSourceId = null;
      sourceUrl = "";
      sourceAppIdentifier = "";
      sourceExtension = "";
      sourceArchitecture = "auto";
      showAddSection = false;
      await Promise.all([checkSource(sourceId), checkInstalled(source)]);
    } catch (error) {
      formError = messageOf(error);
    } finally {
      adding = false;
    }
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([
      ...sources.map((source) => checkSource(source.id)),
      ...sources.map((source) => checkInstalled(source)),
    ]);
    const updatesAvailable = sources.some((source) => hasUpdate(source));
    showSnackbar(updatesAvailable ? "Updates available" : "All your apps are up to date");
  }

  function showSnackbar(message: string, timeout = 5000): void {
    snackbarMessage = message;
    snackbarOpen = true;
    if (snackbarTimer) clearTimeout(snackbarTimer);
    snackbarTimer = setTimeout(() => {
      snackbarOpen = false;
      snackbarTimer = undefined;
    }, timeout);
  }

  function hideSnackbar(): void {
    if (snackbarTimer) clearTimeout(snackbarTimer);
    snackbarTimer = undefined;
    snackbarOpen = false;
  }

  onDestroy(() => {
    if (snackbarTimer) clearTimeout(snackbarTimer);
  });

  async function refreshSource(source: TrackedSource): Promise<void> {
    await Promise.all([checkSource(source.id), checkInstalled(source)]);
  }

  async function checkInstalled(source: TrackedSource): Promise<void> {
    installedCheckErrors = installedCheckErrors.filter((id) => id !== source.id);
    if (!source.appIdentifier) {
      installedVersions[source.id] = undefined;
      return;
    }
    installedVersions[source.id] = undefined;
    try {
      const installedVersion = await invoke<string | null>("get_installed_app_version", {
        identifier: source.appIdentifier,
      });
      installedVersions[source.id] = installedVersion;
      if (installedVersion?.trim()) rememberInstalledVersion(source.id, installedVersion, "detected");
    } catch (error) {
      installedCheckErrors = [...installedCheckErrors, source.id];
      appError = `Could not check whether ${source.repo} is installed: ${messageOf(error)}`;
    }
  }

  function rememberInstalledVersion(
    sourceId: string,
    version: string,
    source: "detected" | "manual",
  ): void {
    const normalized = version.trim();
    if (!normalized) return;
    sources = sources.map((item) =>
      item.id === sourceId
        ? { ...item, lastKnownInstalledVersion: normalized, installedVersionSource: source }
        : item,
    );
  }

  function installedVersionForComparison(source: TrackedSource): string | null {
    const detected = installedVersions[source.id];
    if (typeof detected === "string" && detected.trim()) return detected;
    if (detected === null && source.installedVersionSource !== "manual") return null;
    return source.lastKnownInstalledVersion ?? null;
  }

  function installedVersionIsCurrent(source: TrackedSource): boolean {
    const installed = installedVersionForComparison(source);
    if (!installed || !source.version) return false;
    const installedParts = installed.match(/\d+/g)?.map(Number);
    const latestParts = source.version.match(/\d+/g)?.map(Number);
    return Boolean(
      installedParts?.length && latestParts?.length &&
      Array.from({ length: Math.max(installedParts.length, latestParts.length) }, (_, index) =>
        (installedParts[index] ?? 0) === (latestParts[index] ?? 0),
      ).every(Boolean),
    );
  }

  function markUpToDate(source: TrackedSource): void {
    if (!source.version || source.version === "Unversioned release") return;
    rememberInstalledVersion(source.id, source.version, "manual");
  }

  function isInstalled(source: TrackedSource): boolean {
    return Boolean(installedVersionForComparison(source));
  }

  function operationInFlight(source: TrackedSource): boolean {
    return downloading === source.id || uninstalling === source.id;
  }

  function anyOperationInFlight(): boolean {
    return downloading !== null || uninstalling !== null;
  }

  function installActionLabel(source: TrackedSource): string {
    if (uninstalling === source.id) return "Uninstalling…";
    if (downloading === source.id) return hasUpdate(source) ? "Updating…" : "Installing…";
    if (installedCheckErrors.includes(source.id)) {
      if (hasUpdate(source)) return "Update";
      return isInstalled(source) ? "Uninstall" : "Install";
    }
    if (installedVersions[source.id] === undefined) {
      if (isInstalled(source)) return hasUpdate(source) ? "Update" : "Uninstall";
      return source.appIdentifier ? "Checking…" : "Install";
    }
    if (isInstalled(source)) return hasUpdate(source) ? "Update" : "Uninstall";
    return "Install";
  }

  function canInstallOrUpdate(source: TrackedSource): boolean {
    if (!source.assetUrl || checking.includes(source.id) || anyOperationInFlight()) return false;
    if (
      source.appIdentifier && installedVersions[source.id] === undefined &&
      !source.lastKnownInstalledVersion && !installedCheckErrors.includes(source.id)
    ) return false;
    return !(isInstalled(source) && !hasUpdate(source));
  }

  function canUninstall(source: TrackedSource): boolean {
    if (!source.appIdentifier || checking.includes(source.id) || anyOperationInFlight()) return false;
    if (installedCheckErrors.includes(source.id)) return isInstalled(source);
    if (installedVersions[source.id] === undefined) {
      return Boolean(source.lastKnownInstalledVersion);
    }
    return isInstalled(source);
  }

  async function runPrimaryAction(source: TrackedSource): Promise<void> {
    if (isInstalled(source) && !hasUpdate(source)) {
      await uninstallApp(source);
    } else {
      await downloadAndOpen(source);
    }
  }

  async function uninstallApp(source: TrackedSource): Promise<void> {
    if (!canUninstall(source) || !source.appIdentifier) return;
    const appName = source.repo.split("/").at(-1) ?? source.repo;
    if (!confirm(`Uninstall ${appName} from this device?`)) return;
    uninstalling = source.id;
    sources = sources.map((item) => (item.id === source.id ? { ...item, error: "" } : item));
    try {
      await invoke("uninstall_app", { identifier: source.appIdentifier });
      // The manual fallback must not mask the fresh detection after removal.
      sources = sources.map((item) =>
        item.id === source.id
          ? { ...item, lastKnownInstalledVersion: undefined, installedVersionSource: undefined }
          : item,
      );
      installedVersions[source.id] = undefined;
      await checkInstalled(source);
      showSnackbar(`${appName} was uninstalled.`);
    } catch (error) {
      sources = sources.map((item) =>
        item.id === source.id
          ? { ...item, error: `Could not uninstall the app: ${messageOf(error)}` }
          : item,
      );
    } finally {
      uninstalling = null;
    }
  }

  function hasUpdate(source: TrackedSource): boolean {
    const installedVersion = installedVersionForComparison(source);
    if (!installedVersion || !source.version) return false;
    const installedParts = installedVersion.match(/\d+/g)?.map(Number);
    const latestParts = source.version.match(/\d+/g)?.map(Number);
    if (!installedParts?.length || !latestParts?.length) return false;
    for (let index = 0; index < Math.max(installedParts.length, latestParts.length); index += 1) {
      const installedPart = installedParts[index] ?? 0;
      const latestPart = latestParts[index] ?? 0;
      if (latestPart !== installedPart) return latestPart > installedPart;
    }
    return false;
  }

  async function downloadAndOpen(source: TrackedSource): Promise<void> {
    if (!source.assetUrl || downloading || uninstalling) return;
    downloading = source.id;
    downloadProgress = { downloadId: source.id, phase: "downloading", received: 0, total: null };
    let unlistenProgress: (() => void) | undefined;
    sources = sources.map((item) =>
      item.id === source.id
        ? {
            ...item,
            error: "",
            downloadPath: undefined,
            downloadedSha256: undefined,
            hashVerified: undefined,
          }
        : item,
    );
    try {
      unlistenProgress = await listen<DownloadProgressEvent>("download-progress", (event) => {
        if (event.payload.downloadId === source.id) downloadProgress = event.payload;
      });
      const downloaded = await invoke<{ path: string; sha256: string; verified: boolean }>("download_release_asset", {
        url: source.assetUrl,
        fileName: source.assetName,
        expectedSha256: source.sha256 ?? null,
        downloadId: source.id,
      });
      downloadProgress = {
        downloadId: source.id,
        phase: "opening",
        received: downloadProgress?.received ?? 0,
        total: downloadProgress?.total ?? null,
      };
      sources = sources.map((item) =>
        item.id === source.id
          ? {
              ...item,
              downloadPath: downloaded.path,
              downloadedSha256: downloaded.sha256,
              hashVerified: downloaded.verified,
            }
          : item,
      );
      await openPath(downloaded.path);
      // The installer may register the app immediately; refresh detection so the
      // primary action switches to Uninstall/Update as soon as it is visible.
      await checkInstalled(source);
    } catch (error) {
      const verificationFailure = messageOf(error).match(/failed SHA-256 verification\. Expected [a-f0-9]{64}, got ([a-f0-9]{64})\./i);
      if (verificationFailure) {
        sources = sources.map((item) =>
          item.id === source.id
            ? { ...item, downloadedSha256: verificationFailure[1], hashVerified: false }
            : item,
        );
      }
      const downloadedPath = sources.find((item) => item.id === source.id)?.downloadPath;
      const detail = downloadedPath
        ? `The installer downloaded, but it could not be opened (${downloadedPath}): ${messageOf(error)}`
        : `Could not download the installer: ${messageOf(error)}`;
      sources = sources.map((item) =>
        item.id === source.id ? { ...item, error: detail } : item,
      );
    } finally {
      unlistenProgress?.();
      downloadProgress = null;
      downloading = null;
    }
  }

  async function reopenDownloaded(source: TrackedSource): Promise<void> {
    if (!source.downloadPath) return;
    try {
      await openPath(source.downloadPath);
      sources = sources.map((item) => (item.id === source.id ? { ...item, error: "" } : item));
    } catch (error) {
      sources = sources.map((item) =>
        item.id === source.id
          ? { ...item, error: `Could not open the installer: ${messageOf(error)}` }
          : item,
      );
    }
  }

  function removeSource(source: TrackedSource): boolean {
    if (!confirm(`Remove ${source.repo} from your catalog?`)) return false;
    sources = sources.filter((item) => item.id !== source.id);
    return true;
  }

  function releaseDateLabel(value?: string): string {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
  }

</script>

<svelte:head>
<title>Updainium — Application updates</title>
  <meta
    name="description"
    content="Manage the apps you follow on GitHub and download their latest installers."
  />
</svelte:head>

<div class="app-shell">
  <aside class="sidebar">
    <a class="brand" href="/" aria-label="Updainium, home">
      <img class="brand-logo" src="/logo.svg" alt="" />
      <span>updainium</span>
    </a>
    <div class="sidebar-label">Library</div>
    <button class="nav-item active" type="button">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="6" height="6" rx="1.5"></rect>
        <rect x="14" y="4" width="6" height="6" rx="1.5"></rect>
        <rect x="4" y="14" width="6" height="6" rx="1.5"></rect>
        <rect x="14" y="14" width="6" height="6" rx="1.5"></rect>
      </svg>
      <span>Apps</span>
      <span class="nav-count">{sources.length}</span>
    </button>
    <div class="sidebar-bottom">
      <div class="system-card">
        <span class="system-dot"></span>
        <div><span class="system-label">This device</span><strong>{platformName}</strong></div>
      </div>
      <span class="sidebar-version">UPDAINIUM DESKTOP</span>
    </div>
  </aside>

  <main class="main-content">
    <section class="content">
      {#if appError}
        <div class="notice error-notice" role="alert">{appError}<button onclick={() => (appError = "")} aria-label="Close">×</button></div>
      {/if}
      {#if storageError}
        <div class="notice error-notice" role="alert">{storageError}</div>
      {/if}

      {#if showAddSection}
        <section class="add-section" aria-labelledby="add-title">
          <div class="add-heading">
            <button class="back-button" type="button" aria-label="Back to apps" onclick={() => { showAddSection = false; editingSourceId = null; }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true"><path d="M640-80 240-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
            </button>
            <h1 id="add-title">{editingSourceId ? "Edit app" : "Add an app"}</h1>
          </div>
          <p class="add-intro">{editingSourceId ? "Update the source and release file to follow." : "Add a source and choose which release file to follow."}</p>
          <form class="add-form" onsubmit={saveSource}>
            <label class="add-field">
              <span class="visually-hidden">Repository URL</span>
              <input bind:value={sourceUrl} placeholder="Source URL of the application" type="url" required />
              <span class="field-symbol field-symbol-filled" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></svg>
              </span>
            </label>
            <div class:app-file-drag-over={appFileDragOver} class="identifier-field-row">
              <label class="add-field">
                <span class="visually-hidden">Installed app identifier</span>
                <input bind:value={sourceAppIdentifier} placeholder="Installed app/package identifier (optional)" type="text" />
                <span class="field-symbol" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7l-8-4Z"></path><path d="m9 12 2 2 4-4"></path></svg>
                </span>
              </label>
              <Button
                class="primary-button identify-button"
                variant="unelevated"
                type="button"
                onclick={identifyAppIdentifier}
                disabled={identifyingAppIdentifier || !sourceUrl.trim()}
              >
                {identifyingAppIdentifier ? "Searching…" : "Identify ID"}
              </Button>
              <Button
                class="primary-button identify-button"
                variant="unelevated"
                type="button"
                onclick={chooseAppFile}
                disabled={identifyingAppIdentifier}
              >
                Choose app
              </Button>
            </div>
            <p class="app-file-hint">Or drag the installed app, executable, or package-owned file here.</p>
            <label class="add-field">
              <span class="visually-hidden">File extension</span>
              <input bind:value={sourceExtension} placeholder="File extension, e.g. .AppImage or .zip" type="text" required={!editingSourceId || Boolean(sources.find((source) => source.id === editingSourceId)?.assetExtension)} />
              <span class="field-symbol" aria-hidden="true">
                <svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 4.5 4.5"></path></svg>
              </span>
            </label>
            <label class="add-field">
              <span class="visually-hidden">Architecture</span>
              <select bind:value={sourceArchitecture}>
                {#each architectures as architecture}
                  <option value={architecture.value}>{architecture.label}</option>
                {/each}
              </select>
            </label>
            {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
            <p class="add-hint">The latest release will be checked for the chosen extension and architecture. The identifier must match the app bundle, package, or uninstall registry entry on this device.</p>
            <div class="add-actions">
              <button class="back-link" type="button" onclick={() => { showAddSection = false; editingSourceId = null; }}>Cancel</button>
              <Button class="primary-button" variant="unelevated" type="submit" disabled={adding}>
                {adding ? (editingSourceId ? "Saving…" : "Adding…") : editingSourceId ? "Save changes" : "Add application"}
              </Button>
            </div>
          </form>
        </section>
      {:else if selectedSource}
        <section class="app-detail" aria-labelledby="detail-title">
          <div class="detail-identity">
            <button class="back-button" type="button" aria-label="Back to apps" onclick={() => (selectedSourceId = null)}>
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true"><path d="M640-80 240-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
            </button>
            <div class="detail-avatar" aria-hidden="true">
              {selectedSource.repo.split("/").at(-1)?.slice(0, 1).toUpperCase() ?? "A"}
              {#if selectedSource.iconUrl}
                <img src={selectedSource.iconUrl} alt="" onerror={(event) => event.currentTarget.setAttribute("hidden", "")} />
              {/if}
            </div>
            <div class="detail-name">
              <h1 id="detail-title">{selectedSource.repo.split("/").at(-1)}</h1>
              <span>by {selectedSource.repo.split("/").slice(0, -1).join("/")}</span>
            </div>
          </div>

          <section class="detail-card release-card" aria-label="Latest release">
            <div class="detail-release">
              <div class="detail-section-label">Latest release</div>
              <h2>{selectedSource.version || "Release not checked yet"}</h2>
              <div class="detail-asset">{selectedSource.assetName || `Looking for ${selectedSource.assetExtension || "a release asset"}`}</div>
              <div class="release-published">Release date: {releaseDateLabel(selectedSource.releaseDate)}</div>
            </div>
            <div class="installed-version">
              <span class="detail-section-label">Installed version</span>
              {#if typeof installedVersions[selectedSource.id] === "string" && installedVersions[selectedSource.id]?.trim()}
                <strong>{installedVersions[selectedSource.id]}</strong><span class="version-source">Detected on this device</span>
              {:else if installedVersionForComparison(selectedSource)}
                <strong>{installedVersionForComparison(selectedSource)}</strong><span class="version-source">Last known</span>
              {:else if installedVersions[selectedSource.id] === null}
                <strong>Not detected</strong>
              {:else}
                <strong>Unknown</strong>
              {/if}
            </div>
            {#if selectedSource.version && selectedSource.version !== "Unversioned release" && !installedVersionIsCurrent(selectedSource)}
              <button class="mark-current-button" type="button" onclick={() => markUpToDate(selectedSource)}>
                Mark as up to date
              </button>
              <div class="installed-version-hint">Use this after you finish installing the release.</div>
            {/if}
            {#if selectedSource.error}
              <p class="detail-error" role="alert">{selectedSource.error}</p>
            {/if}
            {#if selectedSource.downloadPath}
              <button class="reopen-link" type="button" onclick={() => reopenDownloaded(selectedSource)}>Open downloaded file</button>
            {/if}
          </section>
          <section class="detail-card hash-card" aria-label="Hash certificate">
            <div class="detail-section-label">Hash certificate (SHA-256)</div>
            {#if selectedSource.sha256}
              <div class="hash-label">Published by source</div>
              <code class="hash-value">{selectedSource.sha256}</code>
            {/if}
            {#if selectedSource.downloadedSha256}
              <div class="hash-label">Downloaded file</div>
              <code class="hash-value">{selectedSource.downloadedSha256}</code>
            {/if}
            <div class:hash-failed={selectedSource.hashVerified === false && Boolean(selectedSource.sha256)} class="hash-status">
              {#if selectedSource.hashVerified === true}
                Verified against the SHA-256 published by the source.
              {:else if selectedSource.hashVerified === false && selectedSource.sha256}
                Verification failed. The downloaded file was not opened.
              {:else if selectedSource.downloadedSha256}
                Calculated locally; no published checksum was available for comparison.
              {:else if selectedSource.sha256}
                The downloaded file will be verified against this published checksum.
              {:else}
                No published checksum available. SHA-256 will be calculated after download, but cannot be verified against the source.
              {/if}
            </div>
          </section>
          <section class="detail-card source-card" aria-label="Source details">
            <a class="detail-repository" href={selectedSource.url} target="_blank" rel="noreferrer">{selectedSource.url}</a>
            <div class="detail-extension">Requested file type <strong>{selectedSource.assetExtension || "Automatic platform match"}</strong></div>
            {#if selectedSource.assetExtension}
              <div class="detail-extension">Architecture <strong>{architectures.find((architecture) => architecture.value === (selectedSource.assetArchitecture ?? "auto"))?.label ?? "Automatic (this device)"}</strong></div>
            {/if}
            {#if selectedSource.assetUrl}
              {#if downloading === selectedSource.id}
                <div class="operation-progress">
                  <div class="operation-progress-row">
                    <span class="operation-progress-label" role="status" aria-live="polite">{downloadStatusLabel}</span>
                    {#if downloadPercent !== null}
                      <span class="operation-progress-percent">{downloadPercent}%</span>
                    {/if}
                  </div>
                  <div
                    class="operation-progress-track"
                    role="progressbar"
                    aria-label={downloadStatusLabel}
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={downloadPercent ?? undefined}
                  >
                    {#if downloadPercent !== null}
                      <span class="operation-progress-fill" style={`width: ${downloadPercent}%`}></span>
                    {:else}
                      <span class="linear-progress-bar primary"><span></span></span>
                      <span class="linear-progress-bar secondary"><span></span></span>
                    {/if}
                  </div>
                  {#if downloadDetailLabel}
                    <div class="operation-progress-detail">{downloadDetailLabel}</div>
                  {/if}
                </div>
              {/if}
              <Button class="detail-download" variant="text" type="button" onclick={() => downloadAndOpen(selectedSource)} disabled={downloading !== null || uninstalling !== null}>
                {#if downloading === selectedSource.id}
                  <span class="button-spinner"></span>{downloadStatusLabel}
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>
                  Download release asset
                {/if}
              </Button>
            {/if}
          </section>

          <div class="detail-actions">
            <button class="detail-icon-button" type="button" aria-label={`Edit ${selectedSource.repo}`} title="Edit app" onclick={() => editSource(selectedSource)} disabled={checking.includes(selectedSource.id) || operationInFlight(selectedSource)}>
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" class="detail-icon-filled" aria-hidden="true"><path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/></svg>
            </button>
            <button class="detail-icon-button" type="button" aria-label="Check release again" title="Check release again" onclick={() => refreshSource(selectedSource)} disabled={checking.includes(selectedSource.id)}>
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" class="detail-icon-filled" class:spinning={checking.includes(selectedSource.id)} aria-hidden="true"><path d="M204-318q-22-38-33-78t-11-82q0-134 93-228t227-94h7l-64-64 56-56 160 160-160 160-56-56 64-64h-7q-100 0-170 70.5T240-478q0 26 6 51t18 49l-60 60ZM481-40 321-200l160-160 56 56-64 64h7q100 0 170-70.5T720-482q0-26-6-51t-18-49l60-60q22 38 33 78t11 82q0 134-93 228t-227 94h-7l64 64-56 56Z"/></svg>
            </button>
            <button class="detail-icon-button" type="button" aria-label={`Remove ${selectedSource.repo}`} title="Remove app" onclick={() => { if (removeSource(selectedSource)) selectedSourceId = null; }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" class="detail-icon-filled" aria-hidden="true"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>
            </button>
            <button
              class="detail-install-button"
              class:destructive={isInstalled(selectedSource) && !hasUpdate(selectedSource)}
              type="button"
              onclick={() => runPrimaryAction(selectedSource)}
              disabled={!canInstallOrUpdate(selectedSource) && !canUninstall(selectedSource)}
            >
              {#if uninstalling === selectedSource.id}<span class="button-spinner"></span>{/if}
              {installActionLabel(selectedSource)}
            </button>
          </div>
        </section>
      {:else}
      <div class="page-heading">
        <div>
          <h1>Apps</h1>
        </div>
        <div class="heading-actions">
          <Button
            class="icon-button refresh-button"
            variant="text"
            type="button"
            aria-label="Check for updates"
            title="Check for updates"
            onclick={refreshAll}
            disabled={!sources.length || checking.length > 0}
          >
            <svg class:spinning={checking.length > 0} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true"><path d="M204-318q-22-38-33-78t-11-82q0-134 93-228t227-94h7l-64-64 56-56 160 160-160 160-56-56 64-64h-7q-100 0-170 70.5T240-478q0 26 6 51t18 49l-60 60ZM481-40 321-200l160-160 56 56-64 64h7q100 0 170-70.5T720-482q0-26-6-51t-18-49l60-60q22 38 33 78t11 82q0 134-93 228t-227 94h-7l64 64-56 56Z"/></svg>
          </Button>
          <a class="settings-button" href="/settings" aria-label="Settings" title="Settings">
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/></svg>
          </a>
          <Button class="primary-button add-button" variant="unelevated" type="button" onclick={() => { editingSourceId = null; sourceAppIdentifier = ""; showAddSection = true; }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></svg>
            Add
          </Button>
        </div>
      </div>

      <div class="summary-row">
        <div class="summary-card">
          <span class="summary-icon purple">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"></rect><rect x="14" y="4" width="6" height="6" rx="1.5"></rect><rect x="4" y="14" width="6" height="6" rx="1.5"></rect><rect x="14" y="14" width="6" height="6" rx="1.5"></rect></svg>
          </span>
          <div><span class="summary-label">In your library</span><strong>{sources.length}</strong></div>
        </div>
        <div class="summary-card">
          <span class="summary-icon green">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>
          </span>
          <div><span class="summary-label">With release detected</span><strong>{sources.filter((source) => source.assetUrl).length}</strong></div>
        </div>
        <div class="summary-card platform-summary">
          <span class="summary-icon blue">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>
          </span>
          <div><span class="summary-label">Installers for</span><strong>{platformName}</strong></div>
        </div>
      </div>

      <div class="list-heading">
        <div><h2>Your library</h2><span class="list-count">{sources.length} {sources.length === 1 ? "app" : "apps"}</span></div>
        <label class="search-box">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
          <input bind:value={filter} placeholder="Search" aria-label="Search apps" />
        </label>
        {#if checking.length > 0}
          <span class="linear-progress" role="progressbar" aria-label="Checking for updates">
            <span class="linear-progress-bar primary"><span></span></span>
            <span class="linear-progress-bar secondary"><span></span></span>
          </span>
        {/if}
      </div>

      {#if !sources.length}
        <div class="empty-state">
          <p>No apps yet. Press Add to get started.</p>
        </div>
      {:else if !visibleSources.length}
        <div class="empty-filter">No apps match “{filter}”.</div>
      {:else}
        <div class="app-list">
          {#each visibleSources as source (source.id)}
            <Card class="app-card" variant="outlined">
              <article class="app-card-content">
                <button class="app-open-button" type="button" onclick={() => (selectedSourceId = source.id)} aria-label={`Open ${source.repo.split("/").at(-1)} details`}>
                  <span class="app-avatar" class:has-icon={Boolean(source.iconUrl)}>
                    {source.repo.split("/").at(-1)?.slice(0, 1).toUpperCase() ?? "G"}
                    {#if source.iconUrl}
                      <img src={source.iconUrl} alt="" onerror={(event) => event.currentTarget.setAttribute("hidden", "")} />
                    {/if}
                    {#if source.error}<span class="avatar-error-badge" title={source.error}></span>{/if}
                  </span>
                  <span class="app-details">
                    <span class="app-title-row">
                      <span class="app-name">{source.repo.split("/").at(-1)}</span>
                      {#if hasUpdate(source)}<span class="update-badge">Update available</span>{/if}
                    </span>
                    <span class="repo-link">by {source.repo.split("/").slice(0, -1).join("/")}</span>
                  </span>
                  <span class="release-summary">
                    {#if source.version}<span class="release-version">{source.version}</span>{/if}
                    <span class="release-date" title="Latest release date">{releaseDateLabel(source.releaseDate)}</span>
                  </span>
                </button>
              </article>
            </Card>
          {/each}
        </div>
      {/if}
      {/if}
    </section>
  </main>

  {#if snackbarOpen}
    <div
      class="snackbar"
      role="status"
      aria-live="polite"
      transition:fly={{ y: 16, duration: 200 }}
    >
      <span class="snackbar-label">{snackbarMessage}</span>
      <button class="snackbar-action" type="button" onclick={hideSnackbar}>Dismiss</button>
    </div>
  {/if}
</div>

<style>
  @font-face {
    font-family: "Roboto";
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
    src: url("../assets/fonts/Roboto/Roboto-VariableFont_wdth,wght.ttf") format("truetype");
  }
  @font-face {
    font-family: "Roboto";
    font-style: italic;
    font-weight: 100 900;
    font-display: swap;
    src: url("../assets/fonts/Roboto/Roboto-Italic-VariableFont_wdth,wght.ttf") format("truetype");
  }
  :global(*) { box-sizing: border-box; }
  :global(body) {
    margin: 0;
    color: #20212a;
    background: #f8f8fb;
    font-family: "Roboto", "Segoe UI", sans-serif;
    font-size: 14px;
    -webkit-font-smoothing: antialiased;
  }
  :global(button), :global(input) { font: inherit; }
  :global(button) { color: inherit; }
  .app-shell { min-height: 100vh; }
  .sidebar {
    position: fixed; inset: 0 auto 0 0; z-index: 2; display: flex; width: 244px; flex-direction: column;
    padding: 29px 16px 19px; background: #fff; border-right: 1px solid #ececf2;
  }
  .brand { display: flex; align-items: center; gap: 11px; padding: 0 11px; color: #252332; text-decoration: none; font-size: 20px; font-weight: 760; letter-spacing: -1px; }
  .brand-logo { display: block; width: 27px; height: 27px; flex: 0 0 auto; border-radius: 8px; }
  .sidebar-label { margin: 49px 11px 12px; color: #9695a3; font-size: 10px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; }
  .nav-item { display: flex; width: 100%; align-items: center; gap: 12px; padding: 11px 12px; border: 0; border-radius: 8px; background: transparent; color: #6b6a78; text-align: left; cursor: default; }
  .nav-item.active { color: #6148d5; background: #f2efff; font-weight: 650; }
  .nav-item svg, .summary-icon svg, .search-box svg, :global(.icon-button svg), :global(.primary-button svg) { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .nav-count { margin-left: auto; color: #888692; font-size: 12px; }
  .sidebar-bottom { margin-top: auto; }
  .system-card { display: flex; align-items: center; gap: 10px; padding: 12px 11px; border: 1px solid #eeedf3; border-radius: 9px; }
  .system-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: #50bb88; box-shadow: 0 0 0 3px #e4f6ed; }
  .system-card div { display: grid; gap: 4px; min-width: 0; }
  .system-label { color: #92919d; font-size: 11px; }
  .system-card strong { overflow: hidden; color: #42414f; font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .sidebar-version { display: block; padding: 17px 11px 0; color: #b0afba; font-size: 9px; font-weight: 650; letter-spacing: 1px; }
  .main-content { min-height: 100vh; margin-left: 244px; }
  .topbar { position: sticky; top: 0; z-index: 1; display: flex; height: 65px; align-items: center; justify-content: space-between; padding: 0 48px; border-bottom: 1px solid #ececf2; background: rgb(255 255 255 / 88%); backdrop-filter: blur(12px); }
  .breadcrumb { display: flex; align-items: center; gap: 11px; color: #93919e; font-size: 12px; }
  .breadcrumb strong { color: #494854; font-weight: 600; }
  .crumb-slash { color: #c9c8d0; }
  .content { width: min(1120px, 100%); margin: 0 auto; padding: 39px 48px 54px; }
  .notice { position: relative; margin: 0 0 20px; padding: 12px 40px 12px 14px; border-radius: 8px; line-height: 1.5; }
  .error-notice { border: 1px solid #f2d5d5; background: #fff5f4; color: #a03e3a; }
  .notice button { position: absolute; top: 4px; right: 10px; border: 0; background: none; color: inherit; font-size: 21px; cursor: pointer; }
  .snackbar { position: fixed; right: 0; bottom: 24px; left: 0; z-index: 60; display: flex; width: fit-content; max-width: min(560px, calc(100vw - 40px)); min-height: 48px; align-items: center; gap: 8px; margin: 0 auto; padding: 12px 10px 12px 18px; border-radius: 10px; background: #2f2b36; box-shadow: 0 8px 24px rgb(24 19 32 / 28%); color: #f4f1f8; font-size: 13px; line-height: 1.45; }
  .snackbar-label { min-width: 0; }
  .snackbar-action { flex: 0 0 auto; padding: 8px 14px; border: 0; border-radius: 7px; background: transparent; color: #d2b7ff; font-size: 12px; font-weight: 650; cursor: pointer; transition: background .15s ease; }
  .snackbar-action:hover { background: rgb(255 255 255 / 10%); }
  .snackbar-action:focus-visible { outline: 2px solid #d2b7ff; outline-offset: 2px; }
  .page-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
  .heading-actions { display: flex; align-items: center; gap: 8px; }
  .settings-button { display: grid; width: 40px; height: 40px; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--accent); transition: color .16s ease; }
  .settings-button:hover { color: var(--accent-strong, var(--accent)); }
  .settings-button:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset: 2px; }
  .settings-button svg { width: 21px; height: 21px; fill: currentColor; }
  h1 { margin: 0; color: #272633; font-size: 29px; font-weight: 720; letter-spacing: -1.15px; }
  :global(.mdc-button) { position: relative; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; gap: 8px; vertical-align: middle; cursor: pointer; }
  :global(.primary-button) { min-height: 39px; padding: 0 15px; border: 1px solid #674fdb; border-radius: 7px; background: #7058e4; box-shadow: 0 2px 4px rgb(81 60 172 / 13%); color: #fff; font-size: 12px; font-weight: 650; transition: background .15s, transform .15s; }
  :global(.primary-button:hover) { background: #6048d2; }
  :global(.primary-button:active) { transform: translateY(1px); }
  :global(.primary-button svg) { width: 16px; height: 16px; }
  :global(.primary-button:disabled) { opacity: .64; cursor: wait; }
  .summary-row { display: grid; grid-template-columns: 1fr 1fr 1.25fr; gap: 13px; margin-top: 30px; }
  .summary-card { display: flex; min-height: 81px; align-items: center; gap: 12px; padding: 14px 15px; border: 1px solid #eeedf3; border-radius: 9px; background: #fff; }
  .summary-icon { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border-radius: 9px; }
  .summary-icon svg { width: 17px; height: 17px; }
  .summary-icon.purple { background: #f1edff; color: #765fe0; }
  .summary-icon.green { background: #e9f8f0; color: #38a975; }
  .summary-icon.blue { background: #eaf3ff; color: #5288d8; }
  .summary-card div { display: grid; gap: 6px; min-width: 0; }
  .summary-label { color: #898894; font-size: 11px; }
  .summary-card strong { overflow: hidden; color: #33323e; font-size: 17px; font-weight: 690; letter-spacing: -.35px; text-overflow: ellipsis; white-space: nowrap; }
  .platform-summary strong { font-size: 12px; }
  .list-heading { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 18px; margin: 38px 0 13px; }
  .list-heading > div { display: flex; align-items: baseline; gap: 10px; }
  h2 { margin: 0; color: #302f3b; font-size: 15px; font-weight: 690; letter-spacing: -.2px; }
  .list-count { color: #a09faa; font-size: 11px; }
  /* Material linear progress indicator (indeterminate) shown while a check for updates is running. */
  .linear-progress {
    position: absolute;
    right: 0;
    bottom: -9px;
    left: 0;
    height: 4px;
    overflow: hidden;
    border-radius: 4px;
    background: var(--surface-muted);
  }
  .linear-progress-bar { position: absolute; top: 0; width: 100%; height: 100%; transform-origin: top left; }
  .linear-progress-bar > span { display: block; width: 100%; height: 100%; border-radius: 4px; background: var(--accent, #705394); }
  .linear-progress-bar.primary { left: -145.166611%; animation: linear-progress-primary-translate 2s infinite linear; }
  .linear-progress-bar.primary > span { animation: linear-progress-primary-scale 2s infinite linear; }
  .linear-progress-bar.secondary { left: -54.888891%; animation: linear-progress-secondary-translate 2s infinite linear; }
  .linear-progress-bar.secondary > span { animation: linear-progress-secondary-scale 2s infinite linear; }
  @keyframes linear-progress-primary-translate {
    0% { transform: translateX(0); }
    20% { animation-timing-function: cubic-bezier(.5, 0, .701732, .495819); transform: translateX(0); }
    59.15% { animation-timing-function: cubic-bezier(.302435, .381352, .55, .956352); transform: translateX(83.67142%); }
    100% { transform: translateX(200.611057%); }
  }
  @keyframes linear-progress-primary-scale {
    0% { transform: scaleX(.08); }
    36.65% { animation-timing-function: cubic-bezier(.334731, .12482, .785844, 1); transform: scaleX(.08); }
    69.15% { animation-timing-function: cubic-bezier(.06, .11, .6, 1); transform: scaleX(.661479); }
    100% { transform: scaleX(.08); }
  }
  @keyframes linear-progress-secondary-translate {
    0% { animation-timing-function: cubic-bezier(.15, 0, .515058, .409685); transform: translateX(0); }
    25% { animation-timing-function: cubic-bezier(.31033, .284058, .8, .733712); transform: translateX(37.651913%); }
    48.35% { animation-timing-function: cubic-bezier(.4, .627035, .6, .902026); transform: translateX(84.386165%); }
    100% { transform: translateX(160.277782%); }
  }
  @keyframes linear-progress-secondary-scale {
    0% { animation-timing-function: cubic-bezier(.205028, .057051, .57661, .453971); transform: scaleX(.08); }
    19.15% { animation-timing-function: cubic-bezier(.152313, .196432, .648374, 1.004315); transform: scaleX(.457104); }
    44.15% { animation-timing-function: cubic-bezier(.257759, -.003163, .211762, 1.38179); transform: scaleX(.72796); }
    100% { transform: scaleX(.08); }
  }
  /* Download/install/update progress in the source card; determinate when the
     server publishes a total size, indeterminate otherwise. */
  .operation-progress { display: grid; gap: 7px; margin-top: 14px; }
  .operation-progress-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .operation-progress-label { color: var(--text, #24212a); font-size: 13px; font-weight: 560; }
  .operation-progress-percent { color: var(--accent-strong, #60427f); font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .operation-progress-track { position: relative; height: 6px; overflow: hidden; border-radius: 4px; background: var(--surface-muted, #eee7f0); }
  .operation-progress-fill { display: block; height: 100%; border-radius: inherit; background: var(--accent, #705394); transition: width .18s ease; }
  .operation-progress-detail { color: var(--muted, #56515d); font-size: 12px; }
  .search-box { display: flex; width: 232px; height: 34px; align-items: center; gap: 8px; padding: 0 9px; border: 1px solid #e9e8ef; border-radius: 6px; background: #fff; color: #a1a0ad; }
  .search-box svg { width: 15px; height: 15px; flex: 0 0 auto; }
  .search-box input { width: 100%; min-width: 0; border: 0; outline: none; background: transparent; color: #454451; font-size: 11px; }
  .search-box input::placeholder { color: #aaa9b4; }
  .app-list { display: grid; gap: 10px; }
  :global(.app-card) { display: flex; min-height: 116px; flex-direction: column; border: 1px solid #eeedf3; border-radius: 9px; background: #fff; transition: border-color .15s, box-shadow .15s; }
  :global(.app-card:hover) { border-color: #e0dcf5; box-shadow: 0 4px 15px rgb(38 28 87 / 4%); }
  .app-card-content { display: flex; min-height: inherit; align-items: center; gap: 15px; padding: 17px 16px; }
  .app-open-button { display: flex; min-width: 0; flex: 1; align-items: center; gap: 15px; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .app-open-button:focus-visible { outline: 2px solid var(--accent, #705394); outline-offset: 4px; border-radius: 8px; }
  .app-avatar { position: relative; display: grid; width: 43px; height: 43px; flex: 0 0 auto; place-items: center; border: 1px solid #e5e1fb; border-radius: 21px; background: linear-gradient(145deg, #f5f2ff, #e9e4ff); color: #725bd8; font-size: 19px; font-weight: 700; }
  .app-avatar.has-icon { border: 0; border-radius: 21px; background: transparent; }
  .app-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 21px; object-fit: contain; }
  .detail-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }
  .app-details { min-width: 0; flex: 1; }
  .app-title-row { display: flex; align-items: center; gap: 9px; }
  .update-badge { display: inline-flex; align-items: center; padding: 4px 8px; border-radius: 999px; background: color-mix(in srgb, var(--accent, #705394) 15%, transparent); color: var(--accent-strong, #60427f); font-size: 10px; font-weight: 650; line-height: 1.2; white-space: nowrap; }
  .app-name { overflow: hidden; margin: 0; color: #34333f; font-size: 14px; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
  .app-name { display: block; }
  .repo-link { display: inline-block; max-width: 100%; overflow: hidden; margin-top: 4px; color: #8c8a98; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .avatar-error-badge { position: absolute; top: -3px; right: -3px; width: 11px; height: 11px; border: 2px solid #fff; border-radius: 50%; background: #b84b48; }
  .reopen-link { margin-top: 5px; padding: 0; border: 0; background: none; color: #6951da; font-size: 11px; cursor: pointer; text-decoration: underline; }
  :global(.icon-button) { display: grid; width: 34px; height: 34px; min-width: 0; flex: 0 0 auto; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 7px; background: transparent; color: #858391; cursor: pointer; }
  :global(.icon-button:hover) { border-color: #e9e7f1; background: #f8f7fb; color: #6650d1; }
  :global(.icon-button:disabled) { opacity: .45; cursor: wait; }
  :global(.icon-button svg) { width: 16px; height: 16px; }
  :global(.refresh-button svg) { width: 21px; height: 21px; fill: currentColor; stroke: none; }
  .spinning { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .button-spinner { width: 12px; height: 12px; border: 2px solid rgb(255 255 255 / 40%); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
  :global(.icon-button.refresh-button) { display: flex; width: 40px; height: 40px; min-width: 0; align-items: center; justify-content: center; gap: 0; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--accent); font-size: 12px; white-space: nowrap; transition: color .16s ease; }
  :global(.icon-button.refresh-button:hover) { background: transparent; color: var(--accent-strong, var(--accent)); }
  :global(.icon-button.refresh-button:disabled) { opacity: .55; }
  .empty-state { display: flex; min-height: 358px; flex-direction: column; align-items: center; justify-content: center; padding: 35px; border: 1px dashed #e5e3ed; border-radius: 10px; background: #fff; text-align: center; }
  .empty-state > p { max-width: 410px; margin: 9px 0 19px; color: #8c8a97; font-size: 12px; line-height: 1.65; }
  .empty-filter { padding: 43px 16px; border: 1px solid #eeedf3; border-radius: 8px; background: #fff; color: #8c8a97; text-align: center; font-size: 12px; }
  .add-section { width: min(760px, 100%); animation: section-enter .2s ease-out both; }
  .add-heading { display: flex; align-items: center; gap: 15px; }
  .add-heading h1 { font-size: 32px; font-weight: 450; letter-spacing: -.6px; }
  .back-button { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--text, #24212a); cursor: pointer; transition: background .16s ease, transform .16s ease; }
  .back-button:hover { background: var(--surface-muted, #eee7f0); }
  .back-button:active { transform: translateX(-2px); }
  .back-button svg { width: 23px; height: 23px; fill: currentColor; stroke: none; }
  .add-intro { margin: 10px 0 26px 53px; color: var(--muted, #56515d); font-size: 14px; }
  .add-form { display: grid; gap: 14px; }
  .identifier-field-row { display: flex; align-items: center; gap: 12px; }
  .identifier-field-row .add-field { min-width: 0; flex: 1; }
  :global(.identify-button) { flex: 0 0 auto; }
  .identifier-field-row.app-file-drag-over { outline: 2px solid var(--accent, #705394); outline-offset: 4px; }
  .app-file-hint { margin: -8px 6px 0; color: var(--muted, #56515d); font-size: 12px; }
  .add-field { display: flex; min-height: 76px; align-items: center; gap: 14px; padding: 0 22px 0 26px; border: 1px solid transparent; border-radius: 26px; background: var(--surface-muted, #eee7f0); color: var(--muted, #56515d); transition: border-color .18s ease, background .18s ease, box-shadow .18s ease; }
  .add-field:focus-within { border-color: color-mix(in srgb, var(--accent, #705394) 34%, transparent); background: var(--surface-raised, #fffaff); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent, #705394) 9%, transparent); }
  .add-field input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text, #24212a); font-size: 17px; }
  .add-field input::placeholder { color: var(--muted, #56515d); opacity: .82; }
  .add-field select { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text, #24212a); font-size: 17px; }
  .field-symbol { display: grid; width: 30px; height: 30px; flex: 0 0 auto; place-items: center; color: var(--muted, #56515d); opacity: .8; }
  .field-symbol svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .field-symbol-filled svg { fill: currentColor; stroke: none; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; clip-path: inset(50%); }
  .form-error { margin: 8px 0 0; color: #b84b48; font-size: 11px; }
  .add-hint { margin: 2px 6px; color: var(--muted, #56515d); font-size: 12px; line-height: 1.55; }
  .add-actions { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 7px; }
  .back-link { padding: 10px 14px; border: 0; border-radius: 20px; background: transparent; color: var(--muted, #56515d); cursor: pointer; transition: background .16s ease; }
  .back-link:hover { background: var(--surface-muted, #eee7f0); }
  .app-detail { width: 100%; animation: section-enter .2s ease-out both; }
  .detail-identity { display: flex; min-height: 118px; align-items: center; gap: 17px; padding: 20px 23px; border-radius: 23px; background: var(--surface, #f7f0f8); }
  .detail-avatar { position: relative; display: grid; width: 68px; height: 68px; flex: 0 0 auto; place-items: center; border-radius: 21px; background: var(--surface-raised, #fffaff); color: var(--accent, #705394); font-size: 27px; }
  .detail-name { min-width: 0; }
  .detail-name h1 { overflow: hidden; margin: 0 0 5px; color: var(--text, #24212a); font-size: 24px; font-weight: 450; letter-spacing: -.35px; text-overflow: ellipsis; white-space: nowrap; }
  .detail-name span { color: var(--muted, #56515d); font-size: 14px; }
  .detail-card { overflow: hidden; margin-top: 17px; border-radius: 22px; background: var(--surface, #f7f0f8); color: var(--text, #24212a); }
  .release-card { padding: 23px 24px; }
  .detail-section-label { margin-bottom: 8px; color: var(--subtle, #817b87); font-size: 12px; }
  .detail-release h2 { margin: 0; color: var(--text, #24212a); font-size: 20px; font-weight: 500; }
  .detail-asset { margin-top: 7px; color: var(--muted, #56515d); font-size: 14px; overflow-wrap: anywhere; }
  .release-published { margin-top: 7px; color: var(--subtle, #817b87); font-size: 12px; }
  .installed-version { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px; margin-top: 17px; color: var(--text, #24212a); font-size: 13px; }
  .installed-version .detail-section-label { flex-basis: 100%; margin: 0; }
  .installed-version strong { font-weight: 550; }
  .version-source { color: var(--subtle, #817b87); font-size: 11px; }
  .mark-current-button { margin-top: 13px; padding: 7px 12px; border: 1px solid var(--border, #e9e0ec); border-radius: 16px; background: var(--surface-raised, #fffaff); color: var(--accent-strong, #60427f); font-size: 12px; cursor: pointer; }
  .mark-current-button:hover { background: var(--surface-muted, #eee7f0); }
  .installed-version-hint { margin-top: 6px; color: var(--subtle, #817b87); font-size: 11px; }
  .detail-error { margin: 12px 0 0; color: #b84b48; font-size: 12px; line-height: 1.5; }
  .release-card .reopen-link { margin-top: 7px; }
  .hash-card { padding: 20px 24px; }
  .hash-label { margin-top: 10px; color: var(--muted, #56515d); font-size: 12px; }
  .hash-value { display: block; margin-top: 4px; color: var(--text, #24212a); font-family: "Roboto Mono", monospace; font-size: 12px; overflow-wrap: anywhere; user-select: all; }
  .hash-status { margin-top: 12px; color: var(--muted, #56515d); font-size: 12px; line-height: 1.5; }
  .hash-status.hash-failed { color: #b84b48; }
  .source-card { padding: 19px 24px; }
  .detail-repository { display: block; overflow-wrap: anywhere; color: var(--text, #24212a); font-size: 15px; font-style: italic; text-decoration: underline; text-underline-offset: 3px; }
  .detail-extension { margin-top: 9px; color: var(--muted, #56515d); font-size: 14px; }
  .detail-extension strong { display: block; margin-top: 4px; color: var(--text, #24212a); font-weight: 450; overflow-wrap: anywhere; }
  :global(.detail-download) { display: flex; width: calc(100% + 48px); min-height: 58px; margin: 19px -24px 0; align-items: center; justify-content: center; gap: 10px; border: 0; border-top: 1px solid color-mix(in srgb, var(--border, #e9e0ec) 60%, transparent); border-radius: 0; background: color-mix(in srgb, var(--surface) 72%, var(--surface-raised)); color: var(--accent-strong, #60427f); font-size: 15px; transition: background .16s ease; }
  :global(.detail-download:hover) { background: var(--surface-muted, #eee7f0); }
  :global(.detail-download svg) { width: 19px; height: 19px; fill: currentColor; stroke: none; }
  :global(.detail-download:disabled) { opacity: .65; cursor: wait; }
  .detail-actions { display: flex; gap: 10px; margin-top: 18px; padding: 20px 22px; border-radius: 22px; background: var(--surface, #f7f0f8); }
  .detail-install-button { min-width: 104px; margin-left: auto; padding: 0 22px; border: 0; border-radius: 22px; background: #e9dcff; color: #4e3973; font-size: 15px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
  .detail-install-button:hover:not(:disabled) { background: #ddcaff; }
  .detail-install-button:disabled { opacity: .48; cursor: not-allowed; }
  .detail-install-button.destructive { background: #fbdcdc; color: #8a2b2b; }
  .detail-install-button.destructive:hover:not(:disabled) { background: #f6c9c9; }
  .detail-install-button .button-spinner { border-color: rgb(78 57 115 / 30%); border-top-color: #4e3973; }
  .detail-icon-button { display: grid; width: 44px; height: 44px; place-items: center; border: 1px solid var(--border, #e9e0ec); border-radius: 50%; background: var(--surface-raised, #fffaff); color: var(--muted, #56515d); cursor: pointer; transition: background .16s ease, color .16s ease, transform .16s ease; }
  .detail-icon-button:hover { background: var(--surface-muted, #eee7f0); color: var(--accent, #705394); }
  .detail-icon-button:active { transform: scale(.96); }
  .detail-icon-button:disabled { opacity: .5; cursor: wait; }
  .detail-icon-button svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .detail-icon-button svg.detail-icon-filled { fill: currentColor; stroke: none; }
  @keyframes section-enter { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
  @media (prefers-reduced-motion: reduce) {
    .add-section, .app-detail { animation: none; }
    .back-button, .add-field, .back-link, .detail-icon-button, :global(.detail-download) { transition: none; }
    .operation-progress-fill { transition: none; }
    .linear-progress-bar, .linear-progress-bar > span { animation: none; }
    .linear-progress-bar.primary { left: 0; }
    .linear-progress-bar.primary > span { transform: none; }
    .linear-progress-bar.secondary { display: none; }
  }
  @media (max-width: 1020px) {
    .sidebar { width: 210px; }
    .main-content { margin-left: 210px; }
    .content { padding-right: 30px; padding-left: 30px; }
    .topbar { padding-right: 30px; padding-left: 30px; }
    .summary-row { grid-template-columns: 1fr 1fr; }
    .platform-summary { grid-column: 1 / -1; }
  }
  @media (max-width: 740px) {
    .sidebar { position: static; width: auto; height: auto; padding: 15px 18px; border-right: 0; border-bottom: 1px solid #ececf2; }
    .brand { font-size: 18px; }
    .sidebar-label, .nav-item, .sidebar-bottom { display: none; }
    .main-content { margin-left: 0; }
    .topbar { height: 49px; padding: 0 19px; }
    .content { padding: 27px 18px 40px; }
    .page-heading { align-items: flex-start; }
    .page-heading :global(.primary-button) { width: 39px; min-width: 39px; overflow: hidden; padding: 0 11px; font-size: 0; }
    .page-heading :global(.primary-button svg) { flex: 0 0 auto; }
    h1 { font-size: 25px; }
    .summary-row { gap: 8px; margin-top: 22px; }
    .summary-card { min-height: 69px; gap: 8px; padding: 10px; }
    .summary-icon { width: 31px; height: 31px; }
    .summary-label { font-size: 9px; }
    .summary-card strong { font-size: 15px; }
    .platform-summary strong { font-size: 11px; }
    .list-heading { align-items: flex-start; flex-direction: column; margin-top: 29px; }
    .search-box { width: 100%; }
    .app-card-content { align-items: flex-start; gap: 10px; padding: 13px 11px; }
    .app-open-button { gap: 10px; }
    .app-avatar { width: 36px; height: 36px; border-radius: 21px; font-size: 16px; }
    .app-title-row { flex-wrap: wrap; gap: 5px; }
    .app-name { font-size: 12px; }
  }
  @media (max-width: 420px) {
    .content { padding-right: 13px; padding-left: 13px; }
    .topbar { padding-right: 13px; padding-left: 13px; }
    .summary-row { grid-template-columns: 1fr; }
    .platform-summary { grid-column: auto; }
    .summary-card { min-height: 58px; }
    .empty-state { min-height: 320px; padding: 24px 17px; }
  }
  @media (min-width: 741px) {
    :global(:root) {
      --page: #fff8ff;
      --surface: #f7f0f8;
      --surface-raised: #fffaff;
      --surface-muted: #eee7f0;
      --text: #24212a;
      --muted: #56515d;
      --subtle: #817b87;
      --border: #e9e0ec;
      --accent: #705394;
      --accent-strong: #60427f;
    }
    :global(body) {
      color: var(--text);
      background: var(--page);
      font-family: "Roboto", "Segoe UI", sans-serif;
    }
    .sidebar { background: var(--page); border-color: var(--border); }
    .brand { color: var(--text); }
    .sidebar-label, .system-label, .summary-label, .list-count, .repo-link { color: var(--subtle); }
    .nav-item { color: var(--muted); }
    .nav-item.active { color: var(--accent); background: var(--surface-muted); }
    .system-card { border-color: var(--border); background: var(--surface); }
    .system-card strong, .breadcrumb strong, h1, h2, .summary-card strong,
    .app-name { color: var(--text); }
    .main-content { background: var(--page); }
    .topbar { border-color: var(--border); background: color-mix(in srgb, var(--page) 88%, transparent); }
    .breadcrumb { color: var(--muted); }
    .crumb-slash { color: var(--subtle); }
    .content { width: min(1240px, 100%); padding: 45px 52px 60px; }
    h1 { font-size: 36px; font-weight: 500; letter-spacing: -.8px; }
    .summary-card, .empty-filter, .empty-state {
      border-color: var(--border);
      background: var(--surface-raised);
    }
    .summary-card { min-height: 88px; border-radius: 18px; }
    .summary-icon.purple { background: var(--surface-muted); color: var(--accent); }
    .list-heading { margin-top: 36px; }
    h2 { font-size: 20px; font-weight: 500; }
    .search-box {
      width: min(340px, 38vw);
      height: 46px;
      gap: 11px;
      padding: 0 17px;
      border: 0;
      border-radius: 24px;
      background: var(--surface-muted);
      color: var(--muted);
    }
    .search-box input { color: var(--text); font-size: 14px; }
    .search-box input::placeholder { color: var(--subtle); }
    .app-list { gap: 12px; }
    :global(.app-card) {
      overflow: hidden;
      border: 1px solid transparent;
      border-radius: 22px;
      background: var(--surface);
      box-shadow: none;
      color: var(--text);
      transition: border-color .15s, background .15s;
    }
    :global(.app-card:hover) {
      border-color: var(--border);
      background: var(--surface-raised);
      box-shadow: none;
    }
    .app-card-content {
      display: flex;
      min-height: 112px;
      align-items: center;
      gap: 18px;
      padding: 20px 22px;
    }
    .app-avatar {
      width: 58px;
      height: 58px;
      border: 0;
      border-radius: 50%;
      background: var(--surface-muted);
      color: var(--accent);
      font-size: 23px;
      font-weight: 500;
    }
    .app-name { font-size: 20px; font-weight: 400; }
    .repo-link { margin-top: 5px; font-size: 13px; }
    :global(.primary-button) {
      min-width: 0;
      border: 0;
      border-radius: 22px;
      background: #e9dcff;
      box-shadow: none;
      color: #4e3973;
      font-size: 13px;
      font-weight: 500;
      text-transform: none;
      transition: background .15s, transform .15s;
    }
    :global(.primary-button:hover) {
      background: #ddcaff;
    }
    :global(.primary-button:active) {
      transform: translateY(1px);
    }
    :global(.primary-button svg) {
      width: 18px;
      height: 18px;
    }
    :global(.icon-button) { color: var(--muted); }
    :global(.icon-button:hover) {
      border-color: transparent;
      background: var(--surface-muted);
      color: var(--accent);
    }
    .empty-state { min-height: 390px; border-style: solid; border-radius: 22px; }
    .empty-filter { border-radius: 20px; color: var(--muted); }
    .empty-state > p { color: var(--muted); font-size: 14px; }
  }
  @media (min-width: 741px) and (prefers-color-scheme: dark) {
    :global(:root) {
      --page: #151217;
      --surface: #201d23;
      --surface-raised: #252128;
      --surface-muted: #302b34;
      --text: #f0eaf3;
      --muted: #c4bbc9;
      --subtle: #a29aa8;
      --border: #39333d;
      --accent: #d2b7ff;
      --accent-strong: #c5a6fb;
    }
    .summary-icon.green { background: #22392d; color: #91d7ad; }
    .summary-icon.blue { background: #222f40; color: #9bc2ff; }
    :global(.primary-button) {
      background: #503d70;
      color: #f2e9ff;
    }
    :global(.primary-button:hover) { background: #624b88; }
    .add-field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 4px rgb(210 183 255 / 10%); }
  }
  :global(:root) {
    --page: #fff8ff;
    --surface: #f7f0f8;
    --surface-raised: #fffaff;
    --surface-muted: #eee7f0;
    --text: #24212a;
    --muted: #56515d;
    --subtle: #817b87;
    --border: #e9e0ec;
    --accent: #705394;
  }
  :global(body) {
    color: var(--text);
    background: var(--page);
    font-family: "Roboto", "Segoe UI", sans-serif;
  }
  .sidebar, .topbar, .summary-row { display: none; }
  .main-content { margin: 0; }
  .content { width: min(940px, 100%); padding: 42px 34px 110px; }
  .page-heading { align-items: center; }
  h1 { color: var(--text); font-size: 34px; font-weight: 400; letter-spacing: -.5px; }
  .list-heading { margin: 22px 0 30px; }
  .list-heading > div { display: none; }
  .search-box {
    width: 100%;
    height: 58px;
    gap: 16px;
    padding: 0 23px;
    border: 0;
    border-radius: 32px;
    background: var(--surface-muted);
    color: var(--muted);
  }
  .search-box svg { width: 21px; height: 21px; }
  .search-box input { color: var(--text); font-size: 17px; }
  .search-box input::placeholder { color: var(--muted); }
  .app-list { gap: 12px; }
  :global(.app-card) {
    min-height: 108px;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: 24px;
    background: var(--surface);
    box-shadow: none;
    color: var(--text);
  }
  :global(.app-card:hover) { border-color: var(--border); background: var(--surface-raised); box-shadow: none; }
  .app-card-content { min-height: 108px; gap: 18px; padding: 18px 24px; }
  .app-open-button { gap: 18px; }
  .app-avatar {
    width: 60px;
    height: 60px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-raised);
    color: var(--accent);
    font-size: 24px;
    font-weight: 500;
  }
  .app-details { flex: 1; }
  .app-name { color: var(--text); font-size: 21px; font-weight: 400; }
  .repo-link { margin-top: 5px; color: var(--muted); font-size: 15px; }
  .release-summary { display: grid; min-width: 120px; gap: 5px; justify-items: end; color: var(--muted); }
  .release-version { font-size: 15px; }
  .release-date { font-size: 14px; font-style: italic; text-decoration: underline; text-underline-offset: 2px; }
  .add-heading h1 { color: var(--text); }
  .add-field { border-radius: 32px; }
  .add-field input { font-size: 18px; }
  .detail-card, .detail-actions { background: var(--surface); }
  .detail-card { border-radius: 25px; }
  .detail-section-label, .detail-name span { color: var(--muted); }
  :global(.detail-download) { background: var(--surface-raised); color: var(--accent); }
  .detail-icon-button { border-color: color-mix(in srgb, var(--border) 75%, transparent); background: var(--surface-raised); }
  :global(.primary-button.add-button) {
    position: fixed;
    right: max(34px, calc((100vw - 940px) / 2 + 34px));
    bottom: 34px;
    z-index: 3;
    min-height: 64px;
    padding: 0 26px;
    border: 0;
    border-radius: 30px;
    background: #e9dcff;
    box-shadow: 0 5px 12px rgb(35 25 48 / 20%);
    color: #503c71;
    font-size: 17px;
    font-weight: 400;
  }
  :global(.primary-button.add-button:hover) { background: #dfcefb; }
  :global(.primary-button.add-button svg) { width: 25px; height: 25px; fill: currentColor; stroke: none; }
  .empty-state { min-height: 150px; justify-content: center; border: 0; border-radius: 24px; background: var(--surface); }
  .empty-state > p { margin: 0; color: var(--muted); font-size: 15px; }
  .empty-filter { border: 0; border-radius: 24px; background: var(--surface); color: var(--muted); }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --page: #151217;
      --surface: #201d23;
      --surface-raised: #252128;
      --surface-muted: #302b34;
      --text: #f0eaf3;
      --muted: #c4bbc9;
      --subtle: #a29aa8;
      --border: #39333d;
      --accent: #d2b7ff;
    }
    .detail-install-button { background: #503d70; color: #f2e9ff; }
    .detail-install-button:hover:not(:disabled) { background: #624b88; }
    .detail-install-button.destructive { background: #6e3232; color: #ffdede; }
    .detail-install-button.destructive:hover:not(:disabled) { background: #824040; }
    .detail-install-button .button-spinner { border-color: rgb(242 233 255 / 30%); border-top-color: #f2e9ff; }
    :global(.primary-button.add-button) { background: #503d70; color: #f2e9ff; }
    :global(.primary-button.add-button:hover) { background: #624b88; }
  }
  @media (max-width: 600px) {
    .content { padding: 25px 18px 105px; }
    .page-heading { align-items: center; }
    h1 { font-size: 30px; }
    .search-box { height: 54px; }
    .app-card-content { min-height: 96px; gap: 12px; padding: 15px 16px; }
    .app-open-button { gap: 12px; }
    .app-avatar { width: 50px; height: 50px; }
    .app-name { font-size: 18px; }
    .repo-link { font-size: 13px; }
    .release-summary { min-width: 72px; }
    .release-version { font-size: 13px; }
    .release-date { font-size: 12px; }
    :global(.primary-button.add-button) { right: 20px; bottom: 20px; min-height: 58px; padding: 0 22px; }
    .add-heading { gap: 9px; }
    .add-heading h1 { font-size: 29px; }
    .add-intro { margin: 9px 0 23px 47px; font-size: 13px; }
    .add-form { gap: 12px; }
    .add-field { min-height: 76px; padding: 0 17px 0 22px; border-radius: 28px; }
    .add-field input { font-size: 16px; }
    .identifier-field-row { flex-wrap: wrap; }
    .identifier-field-row .add-field { flex-basis: 100%; }
    .add-hint { margin: 3px 5px; font-size: 12px; }
    .add-actions { margin-top: 8px; }
    .detail-identity { min-height: 112px; gap: 12px; padding: 17px 14px; }
    .detail-identity .back-button { width: 30px; height: 36px; }
    .detail-avatar { width: 58px; height: 58px; border-radius: 18px; font-size: 23px; }
    .detail-name h1 { font-size: 21px; }
    .detail-name span { font-size: 13px; }
    .detail-card { margin-top: 14px; border-radius: 22px; }
    .release-card { padding: 21px 19px; }
    .detail-release h2 { font-size: 18px; }
    .detail-asset, .detail-extension { font-size: 13px; }
    .source-card { padding: 19px 19px 0; }
    .detail-repository { font-size: 14px; }
    :global(.detail-download) { width: calc(100% + 38px); min-height: 58px; margin-right: -19px; margin-left: -19px; font-size: 14px; }
    .detail-actions { gap: 8px; margin-top: 14px; padding: 17px 12px; border-radius: 22px; }
    .detail-install-button { min-width: 82px; padding: 0 12px; font-size: 13px; }
  }
</style>
