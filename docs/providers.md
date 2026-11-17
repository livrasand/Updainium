# Providers and plugins

Updainium reads release data through providers. A provider turns a repository
URL into API URLs and converts the API response into the release shape the app
uses. GitHub, GitLab, and Gitea/Forgejo are built in. A local plugin can add
another forge or new commands to the command palette without changing the
application code.

## Built-in providers

The built-in providers cover the most common Git forges:

| Provider | Supported hosts | Notes |
| --- | --- | --- |
| GitHub | `github.com` | Uses the GitHub REST API (`api.github.com`). Supports public releases and bearer token authentication for higher rate limits. |
| GitLab | `gitlab.com`, self-hosted GitLab | Uses the GitLab Releases API (`/api/v4/projects/:id/releases`). Supports public projects. |
| Gitea / Forgejo | `codeberg.org`, self-hosted Gitea and Forgejo | Uses the Gitea Releases API (`/api/v1/repos/:owner/:repo/releases`). Supports public instances. |

Providers run in the application's frontend. Network requests go through the
standard `fetch` API. When an asset is downloaded, the Rust backend handles the
download and writes it to the cache directory.

## Provider interface

Every provider implements the `Provider` interface defined in
`src/lib/providers/types.ts`:

```ts
export type Provider = {
  id: string;
  match(url: URL): boolean;
  reference(url: URL): SourceReference;
  repoApiUrl(reference: SourceReference): string;
  releaseApiUrls(reference: SourceReference): string[];
  normalize(payload: unknown, reference: SourceReference): NormalizedRelease;
};
```

### Methods

- `match(url: URL): boolean`
  Returns `true` if this provider handles the given repository URL. The URL is
  guaranteed to be HTTPS and to contain at least an owner and a repository name.
  Called in order; the first provider that returns `true` is used.

- `reference(url: URL): SourceReference`
  Extracts the repository identity from the URL. The returned `SourceReference`
  contains the normalized `repo` string (for example, `github.com/owner/repo`),
  the canonical repository URL, the `repositoryPath`, and the provider `id`.

- `repoApiUrl(reference: SourceReference): string`
  Returns the API endpoint used to verify that the repository exists and is
  accessible. Called before releases are fetched.

- `releaseApiUrls(reference: SourceReference): string[]`
  Returns an array of API endpoints to try in order when fetching releases.
  The first endpoint that returns an HTTP 200 with parseable data is used. For
  example, GitHub tries `/releases/latest` first and falls back to `/releases`
  if the latest endpoint returns a 404 (common when a repository only has
  pre-releases).

- `normalize(payload: unknown, reference: SourceReference): NormalizedRelease`
  Converts the forge's API response into Updainium's standard `NormalizedRelease`
  shape. The method must handle unexpected payloads defensively and return
  `null` or empty fields when data is missing.

### Normalized release shape

```ts
export type NormalizedRelease = {
  tag_name?: string;
  name?: string;
  published_at?: string | null;
  body?: string | null;
  assets: NormalizedAsset[];
};

export type NormalizedAsset = {
  name: string;
  browser_download_url: string;
  sha256?: string;
};
```

If the forge provides asset checksums (for example, Gitea provides a `digest`
field), `normalize` should populate `sha256` so the download manager can verify
the file integrity automatically.

## Adding a built-in provider

To add a provider to the Updainium source tree:

1. Create `src/lib/providers/<forge>.ts`.
2. Implement the `Provider` interface and export the provider object.
3. Add the provider to the `builtInProviders` array in `src/lib/registry.ts`.
4. Export the provider from `src/lib/providers/index.ts` if one exists.
5. Add unit tests for `match`, `reference`, and `normalize` in `tests/`.
6. Run the validation commands below.

Built-in providers are part of the application and must keep the project's
privacy and security rules: no telemetry, no third-party service integrations,
HTTPS only, and no automatic installation or updates.

## User plugins

A user plugin can be a directory with an `updainium.json` manifest or a
self-contained `.js` file. Plugins can contribute providers, commands for the
command palette, and keybindings.

### Plugin directory locations

In production, the application loads plugins from the `plugins` folder inside
the configuration directory:

| System | Plugins directory |
| --- | --- |
| macOS | `~/Library/Application Support/com.livrasand.updainium/plugins` |
| Linux | `~/.config/com.livrasand.updainium/plugins` |
| Windows | `%APPDATA%\com.livrasand.updainium\plugins` |

### Development mode

When developing plugins with `npm run tauri dev`, Updainium can read plugins
directly from a local directory in the project root (`plugins/`) or from a path
set in `VITE_DEV_PLUGINS_DIR`. This allows testing changes immediately without
reinstalling the plugin into the configuration directory.

### Manifest format: `updainium.json`

A manifest-based plugin resides in its own folder inside `plugins/` (for example,
`plugins/sourcehut/` or `plugins/my-plugin/`) and includes an `updainium.json` file:

```json
{
  "id": "sourcehut-provider",
  "version": "0.1.0",
  "engines": {
    "updainium": "^1.4"
  },
  "main": "index.js",
  "contributes": {
    "providers": ["provider.js"],
    "commands": ["commands.js"],
    "keybindings": [
      {
        "command": "sourcehut.sync",
        "key": "mod+shift+s"
      }
    ]
  }
}
```

### Manifest fields

- `id` (required, string): Unique identifier for the plugin.
- `version` (optional, string): Plugin version.
- `engines.updainium` (optional, string): Semver requirement for Updainium (such
  as `^1.4` or `>=1.4`). Plugins requiring an incompatible version are skipped.
- `main` (optional, string): Entry JavaScript file relative to the plugin folder
  (defaults to `index.js`).
- `contributes.providers` (optional, array): Array of relative JavaScript file
  paths or provider objects.
- `contributes.commands` (optional, array): Array of relative JavaScript file
  paths or command definitions.
- `contributes.keybindings` (optional, array or object): Keybinding definitions
  mapping commands to shortcut combinations.

### Keybinding contributions

Keybindings can be defined as an array of objects or as a mapping:

```json
"keybindings": [
  {
    "command": "sourcehut.sync",
    "key": "ctrl+shift+s",
    "mac": "cmd+shift+s"
  }
]
```

Or:

```json
"keybindings": {
  "sourcehut.sync": "mod+shift+s"
}
```

The `mod` modifier maps to `Cmd` on macOS and `Ctrl` on Windows and Linux.

### Command contributions

A command definition in `updainium.json` or in contributed files has this shape:

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

If defined in `updainium.json`, the command's execution function can be exported
from `main` (matching the command id). If defined in a contributed JavaScript
file, the full command object with `run` can be exported directly.

### Single-file plugins

For simple cases, a plugin can also be a standalone `.js` file placed directly in
`plugins/`. The file can default-export:

- A provider object.
- A command object.
- An object with `providers` and `commands` arrays.

### Rules

- Use `.js` for JavaScript sources and `.json` for manifests.
- In manifest plugins, file paths in `main` and `contributes` are resolved
  relative to the plugin directory.
- A provider with an existing id replaces the built-in provider with that id.
  New providers are tried before the built-in providers.
- A command with an existing id replaces any previous command with the same id.
- Commands run in the WebView with the application's Tauri capabilities.
- Invalid or incompatible plugins are skipped safely without stopping other
  plugins.

### Example: manifest plugin with provider and command

Folder structure:

```text
plugins/
  sourcehut/
    updainium.json
    index.js
    provider.js
```

`plugins/sourcehut/updainium.json`:

```json
{
  "id": "sourcehut-provider",
  "version": "0.1.0",
  "engines": {
    "updainium": "^1.4"
  },
  "main": "index.js",
  "contributes": {
    "providers": ["provider.js"],
    "keybindings": {
      "sourcehut.open": "mod+alt+s"
    }
  }
}
```

`plugins/sourcehut/provider.js`:

```js
export default {
  id: "sourcehut",
  match(url) {
    return url.hostname === "git.sr.ht";
  },
  reference(url) {
    const parts = url.pathname.split("/").filter(Boolean);
    const repositoryPath = parts.slice(0, 2).join("/");
    return {
      repo: `git.sr.ht/${repositoryPath}`,
      url: `https://git.sr.ht/${repositoryPath}`,
      repositoryPath,
      provider: "sourcehut",
    };
  },
  repoApiUrl(reference) {
    return `https://git.sr.ht/api/${reference.repositoryPath}`;
  },
  releaseApiUrls(reference) {
    return [`https://git.sr.ht/api/${reference.repositoryPath}/releases`];
  },
  normalize(payload) {
    const release = Array.isArray(payload) ? payload[0] : payload;
    return {
      tag_name: release?.tag_name,
      name: release?.name,
      published_at: release?.published_at,
      body: release?.body,
      assets: [],
    };
  },
};
```

`plugins/sourcehut/index.js`:

```js
export default {
  commands: [
    {
      id: "sourcehut.open",
      title: "Open SourceHut",
      category: "SourceHut",
      run() {
        window.open("https://sr.ht", "_blank");
      },
    },
  ],
};
```

## Security

Plugins are trusted code, not sandboxed extensions. They run in the WebView and
have access to the same resources as the application UI: network access through
`fetch`, local storage, clipboard, and the Tauri IPC commands permitted by the
application's capability files.

The application still enforces these boundaries for release checks:

- Network requests during release checks only connect to the URLs returned by
  `repoApiUrl` and `releaseApiUrls`.
- Release downloads are validated by sha256 checksums if the provider returned
  one.
- Tokens are stored in the operating system credential store, not in plugin
  storage or `localStorage`.
- Plugins cannot change the Rust backend, the Tauri capability set, or the
  installed application files through the provider or command interface.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| The plugin does not appear | Confirm `updainium.json` has a valid `id`, that `engines.updainium` matches the app version, and that files are in the plugins folder. |
| The plugin appears but never matches | Check `match`. It receives a `URL` object. Return `true` only for your host. |
| The plugin command does not appear | Confirm the command has `id`, `title`, and `run`. Open the palette with `Cmd/Ctrl+Shift+P`. |
| The repository is rejected | The URL must be HTTPS, must not contain credentials, and must include at least an owner and repository. |
| No release is found | Confirm the repository is public, has a published release, and the API URLs in `releaseApiUrls` are correct. |
| A built-in provider stopped working | A plugin is using the same `id`. Remove the plugin or change its id. |
| A built-in command stopped working | A plugin command is using the same `id`. Remove the plugin or change the command id. |
| The plugin throws on load | Check that files are valid JavaScript and paths in `updainium.json` exist. |

## Validation

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

For a manual plugin check, run `npm run tauri dev`, place the plugin in the
local `plugins/` directory, open the command palette with `Cmd/Ctrl+Shift+P`,
and confirm the plugin command appears.

## Related files

- `src/lib/providers/types.ts`
- `src/lib/providers/shared.ts`
- `src/lib/providers/github.ts`
- `src/lib/providers/gitlab.ts`
- `src/lib/providers/gitea.ts`
- `src/lib/registry.ts`
- `src/lib/commands.ts`
- `src/lib/keymap.ts`
- `src/lib/CommandPalette.svelte`
- `src/lib/assets.ts`
- `src-tauri/src/lib.rs`
