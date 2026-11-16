# Providers and plugins

Updainium reads release data through providers. A provider turns a repository
URL into API URLs and converts the API response into the release shape the app
uses. GitHub, GitLab, and Gitea/Forgejo are built in. A local plugin can add
another forge or new commands to the command palette without changing the
application code.

## Built-in providers

| id | Matches | Repository API | Release API |
| --- | --- | --- | --- |
| `github` | `github.com` | `https://api.github.com/repos/{owner}/{repo}` | `https://api.github.com/repos/{owner}/{repo}/releases/latest` |
| `gitlab` | `gitlab.com` and self-hosted GitLab URLs with a `/-/` path marker | `{origin}/api/v4/projects/{encoded path}` | `{origin}/api/v4/projects/{encoded path}/releases/permalink/latest` |
| `gitea` | Every other HTTPS host | `{origin}/api/v1/repos/{owner}/{repo}` | `{origin}/api/v1/repos/{owner}/{repo}/releases/latest`, then the `api/v3` equivalent, then the `api/v4` permalink |

The Gitea provider is the fallback. Any public HTTPS repository URL that is not
recognized as GitHub or GitLab is parsed as Gitea. This covers Gitea, Forgejo,
Codeberg, and self-hosted Gitea instances.

## How a source is resolved

1. The app parses the entered URL and rejects non-HTTPS URLs and URLs with
   credentials.
2. `src/lib/registry.ts` asks each provider whether it matches the URL. User
   plugins are tried first, then the built-in providers in this order: GitHub,
   GitLab, Gitea.
3. The selected provider returns a `SourceReference` with the repository name,
   canonical URL, repository path, and provider id.
4. `repoApiUrl(reference)` is used to fetch the repository icon.
5. `releaseApiUrls(reference)` is passed to the Rust backend. The backend tries
   the URLs in order and returns the first successful response as raw JSON.
6. `normalize(payload)` converts that JSON into a `Release`.
7. The existing asset selection in `src/lib/assets.ts` picks the file that
   matches the platform and the user's extension or architecture preference.

Only HTTPS URLs are accepted for release requests. Redirects are limited to
HTTPS, and the GitHub token is sent only to `api.github.com`.

## Provider interface

Providers are plain objects that satisfy this interface:

```ts
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
```

| Member | Purpose |
| --- | --- |
| `id` | Stable identifier. A plugin with the same id as a built-in provider replaces that built-in. |
| `match` | Returns `true` when the provider handles the URL. Keep this check specific. |
| `reference` | Normalizes the URL into a repository reference. It should remove a trailing `.git`, drop `/releases` and similar suffixes, and return an HTTPS URL. |
| `repoApiUrl` | Returns the API URL used for repository metadata, currently the icon. |
| `releaseApiUrls` | Returns the release API URLs to try, in order. |
| `normalize` | Converts the raw API response into a `Release`. It must be pure and must not throw on malformed input. |
| `assetScore` | Optional hook reserved for custom asset ranking. The current asset selection does not call it. |

## Normalization rules

`src/lib/providers/shared.ts` contains the built-in normalization logic. A
provider that uses the standard API shapes can reuse it. A plugin cannot import
application modules, so a plugin must include its own normalization code.

The built-in normalization accepts these response shapes:

- A single release object.
- A non-empty array of releases, using the first item.
- `assets` as an array of objects with `name` and `browser_download_url`.
- GitLab-style `assets.links` with `name` and `direct_asset_url`, falling back
  to `url`.
- `tag_name` and `name` for the version and release name.
- `published_at`, `released_at`, or `created_at` for the release date.
- `body` or `description` for the release notes.
- `digest` or `sha256` for the asset checksum. A `sha256:` prefix is removed,
  the value must be 64 hexadecimal characters, and it is stored in lowercase.

Empty strings, missing names, missing URLs, and malformed checksums are ignored.
Malformed assets do not invalidate the rest of the release.

## Adding a built-in provider

1. Create `src/lib/providers/{id}.ts`.
2. Export a `Provider` object. Use `createReference` and `normalizeRelease` from
   `./shared` when the provider follows the standard shapes.
3. Register the provider in `src/lib/registry.ts`. Put specific providers before
   `giteaProvider`, because the Gitea provider matches every host.
4. Add tests under `tests/` for URL parsing, API URL construction, and
   normalization.
5. Update this document.
6. Run the validation commands below.

Built-in providers are part of the application and must keep the project's
privacy and security rules: no telemetry, no third-party service integrations,
HTTPS only, and no automatic installation or updates.

## User plugins

A user plugin is a self-contained JavaScript file. It can default-export a
provider, a command, or an object with `providers` and `commands` arrays. The
app loads plugins from the `plugins` directory inside its configuration
directory.

| System | Plugins directory |
| --- | --- |
| macOS | `~/Library/Application Support/com.livrasand.updainium/plugins` |
| Linux | `~/.config/com.livrasand.updainium/plugins` |
| Windows | `%APPDATA%\com.livrasand.updainium\plugins` |

Create the directory if it does not exist, add one or more `.js` files, and
restart the app. Plugins are loaded before the saved catalog is checked.

### Plugin shape

A plugin can export one of these forms:

- A provider object.
- A command object.
- An object with `providers` and `commands` arrays.

Both arrays are optional. Each entry is validated, and invalid entries are
ignored.

A command has this shape:

```ts
type Command = {
  id: string;
  title: string;
  category?: string;
  keywords?: string[];
  when?: () => boolean;
  run: () => void | Promise<void>;
};
```

### Rules

- The file must be valid ECMAScript and must default-export a provider, a
  command, or an object with `providers` and `commands` arrays.
- Use `.js`. TypeScript, JSON, and other file types are ignored.
- Files are read directly from the `plugins` directory. Subdirectories are not
  scanned.
- The file must be self-contained. The loader reads the file and imports it as a
  blob module, so relative imports, bare package imports, and imports of
  application modules do not resolve.
- Keep the module free of top-level side effects. It should only declare and
  export the plugin objects.
- A provider with an existing id replaces the built-in provider with that id.
  New providers are tried before the built-in providers.
- A command with an existing id replaces the previous command. Use stable, unique
  ids.
- `run` may be synchronous or asynchronous. The palette waits for it and shows an
  error if it throws.
- `when` is optional. It is checked when the palette opens; return `false` to
  hide the command.
- Commands run in the WebView. They can use browser APIs and the Tauri commands
  allowed by the app's capabilities.
- Invalid files are skipped. If a plugin does not appear, check its syntax, its
  default export, and its location.
- Plugins run in the application's WebView with the application's Tauri
  permissions. Install only plugins from sources you trust.

There is no plugin manifest, signature verification, version check, or automatic
update. A plugin is local code under your control.

### Example: a Gitea-compatible host

```js
export default {
  id: "example-gitea",
  match(url) {
    return url.hostname.toLowerCase() === "git.example.com";
  },
  reference(url) {
    const parts = url.pathname.split("/").filter(Boolean);
    const marker = parts.indexOf("releases");
    const repositoryParts = marker >= 2 ? parts.slice(0, marker) : parts;
    const repositoryPath = repositoryParts.join("/").replace(/\.git$/i, "");
    const baseUrl = new URL(`/${repositoryPath}`, url.origin).toString().replace(/\/$/, "");
    return {
      repo: `${url.hostname.toLowerCase()}/${repositoryPath}`,
      url: baseUrl,
      repositoryPath,
      provider: "example-gitea",
    };
  },
  repoApiUrl(reference) {
    return `${new URL(reference.url).origin}/api/v1/repos/${reference.repositoryPath}`;
  },
  releaseApiUrls(reference) {
    const origin = new URL(reference.url).origin;
    return [`${origin}/api/v1/repos/${reference.repositoryPath}/releases/latest`];
  },
  normalize(payload) {
    const release = Array.isArray(payload) ? payload[0] : payload;
    const assets = Array.isArray(release?.assets)
      ? release.assets.flatMap((asset) => {
          if (typeof asset?.name !== "string" || typeof asset?.browser_download_url !== "string") {
            return [];
          }
          const sha256 =
            typeof asset.digest === "string" && /^sha256:[0-9a-f]{64}$/i.test(asset.digest)
              ? asset.digest.slice(7).toLowerCase()
              : typeof asset.sha256 === "string" && /^[0-9a-f]{64}$/i.test(asset.sha256)
                ? asset.sha256.toLowerCase()
                : undefined;
          return [{ name: asset.name, browser_download_url: asset.browser_download_url, sha256 }];
        })
      : [];
    return {
      tag_name: typeof release?.tag_name === "string" && release.tag_name ? release.tag_name : undefined,
      name: typeof release?.name === "string" && release.name ? release.name : undefined,
      published_at: typeof release?.published_at === "string" ? release.published_at : null,
      body: typeof release?.body === "string" ? release.body : null,
      assets,
    };
  },
};
```

This example handles a Gitea-style release response. Adapt `match`,
`repoApiUrl`, `releaseApiUrls`, and `normalize` to the target forge's API.

### Command contributions

Commands appear in the command palette. On macOS, open it with `Cmd+Shift+P`;
on Windows and Linux, use `Ctrl+Shift+P`. The palette lists the commands
registered by the app and by plugins, filtered by title, category, and
keywords.

A command-only plugin can look like this:

```js
export default {
  commands: [
    {
      id: "example.openDocs",
      title: "Open Example Forge docs",
      category: "Example",
      keywords: ["docs", "help"],
      run() {
        window.open("https://git.example.com/help", "_blank");
      },
    },
  ],
};
```

A plugin can combine providers and commands in the same default export:

```js
export default {
  providers: [exampleProvider],
  commands: [exampleCommand],
};
```

`exampleProvider` and `exampleCommand` are objects defined in the same file. A
command `run` function can use browser APIs and the Tauri commands allowed by
the app's capabilities. It cannot import application modules or packages.

## Security

Plugins are trusted code, not sandboxed extensions. They run in the WebView and
can use the Tauri commands allowed by the app's capabilities. Review a plugin
before installing it.

The application still enforces these boundaries for release checks:

- Release API URLs must use HTTPS.
- Redirects are limited to HTTPS.
- The GitHub token is sent only to `api.github.com`.
- Tokens are stored in the operating system credential store, not in plugin
  storage or `localStorage`.
- Plugins cannot change the Rust backend, the Tauri capability set, or the
  installed application files through the provider or command interface.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| The plugin does not appear | Confirm the file is in the plugins directory, has a `.js` extension, default-exports a provider, a command, or an object with `providers` and `commands` arrays, and the app was restarted. |
| The plugin appears but never matches | Check `match`. It receives a `URL` object. Return `true` only for your host. |
| The plugin command does not appear | Confirm the command has `id`, `title`, and `run`, the plugin was loaded, and the app was restarted. Open the palette with `Cmd/Ctrl+Shift+P`. |
| The repository is rejected | The URL must be HTTPS, must not contain credentials, and must include at least an owner and repository. |
| No release is found | Confirm the repository is public, has a published release, and the API URLs in `releaseApiUrls` are correct. |
| A built-in provider stopped working | A plugin is using the same `id`. Remove the plugin or change its id. |
| A built-in command stopped working | A plugin command is using the same `id`. Remove the plugin or change the command id. |
| The plugin throws on load | The file must be self-contained and valid JavaScript. Imports of application modules or packages do not work. |

## Validation

```sh
node --test tests/*.test.mjs
npm run check
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

For a manual plugin check, run `npm run tauri dev`, place the plugin in the
plugins directory, restart the app, open the command palette with
`Cmd/Ctrl+Shift+P`, and confirm the plugin command appears. Add a repository that
matches the plugin and confirm that the release date, notes, version, and asset
are populated.

## Related files

- `src/lib/providers/types.ts`
- `src/lib/providers/shared.ts`
- `src/lib/providers/github.ts`
- `src/lib/providers/gitlab.ts`
- `src/lib/providers/gitea.ts`
- `src/lib/registry.ts`
- `src/lib/commands.ts`
- `src/lib/CommandPalette.svelte`
- `src/lib/assets.ts`
- `src-tauri/src/lib.rs`