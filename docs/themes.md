# Custom themes and styling

Updainium includes a custom theme and script system that allows full control over the visual appearance and startup behavior of the application without recompiling the code.

## How it works

The styling and scripting system consists of:

- **Themes directory (`themes/`)**: A folder inside the application's configuration directory holding installable `.css` theme files.
- **Active theme marker (`theme`)**: A file inside the configuration directory containing the name of the currently active theme (for example, `nord.css`).
- **Injectable styles (`styles.css`)**: An optional `.css` file in the configuration directory loaded on startup for user-defined CSS overrides.
- **Init script (`init.js`)**: An optional `.js` file in the configuration directory executed inside the WebView environment when the application launches.

## Configuration locations

| System | Configuration directory |
| --- | --- |
| macOS | `~/Library/Application Support/com.livrasand.updainium` |
| Linux | `~/.config/com.livrasand.updainium` |
| Windows | `%APPDATA%\com.livrasand.updainium` |

Inside this folder, you can create:

- `theme`: A plain text file with the name of the active theme (e.g. `dracula.css`).
- `themes/`: A folder containing `.css` files.
- `styles.css`: Custom CSS rules loaded at startup.
- `init.js`: JavaScript code executed when the app loads.

In development mode (`npm run tauri dev`), Updainium can also read `themes/`, `styles.css`, `theme`, and `init.js` directly from the local project root.

## CSS variables

Updainium uses standard CSS variables for colors, surfaces, and accents. Custom themes can override these variables on `:root` to restyle the interface:

| Variable | Description |
| --- | --- |
| `--up-bg` | Main background color of the window |
| `--up-surface` | Background color for cards, panels, and lists |
| `--up-surface-raised` | Raised elements such as hover cards and dialogs |
| `--up-surface-muted` | Muted surfaces, chips, and sub-elements |
| `--up-text` | Primary body text color |
| `--up-muted` | Secondary or muted text color |
| `--up-subtle` | Subtle text, icons, and placeholder color |
| `--up-border` | Border and divider line color |
| `--up-accent` | Highlight and accent color for buttons and links |

The application automatically aliases `--page`, `--surface`, and other layout variables to these `--up-*` definitions.

### Example theme: `themes/dracula.css`

```css
:root {
  --up-bg: #282a36;
  --up-surface: #343746;
  --up-surface-raised: #44475a;
  --up-surface-muted: #21222c;
  --up-text: #f8f8f2;
  --up-muted: #bfbfbf;
  --up-subtle: #6272a4;
  --up-border: #6272a4;
  --up-accent: #bd93f9;
}
```

## Injectable styles: `styles.css`

If you only want quick tweaks rather than a full theme, create `styles.css` in the configuration directory. This file is injected into the `<head>` on startup after any active theme:

```css
body {
  font-family: monospace;
}

.snackbar {
  border-radius: 4px;
}
```

## Init script: `init.js`

You can place an `init.js` script in the configuration directory to run custom setup code when the application launches. The script runs in the WebView context with access to standard browser APIs.

```js
console.log("Updainium custom init script loaded");
```

## Managing themes

Use the command palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux) to manage themes:

- **Install local theme…** (`themes.installLocal`): Pick a `.css` file to copy it into `themes/` and activate it immediately.
- **List installed themes** (`themes.listInstalled`): View all themes currently installed in `themes/` and which one is active.
- **Select theme…** (`themes.select`): Switch to another installed theme from `themes/`.
- **Uninstall theme…** (`themes.uninstall`): Delete an installed theme file from `themes/`.
- **Open styles.css** (`config.openStylesCss`): Open or create `styles.css` in your default text editor.
- **Open init.js** (`config.openInitJs`): Open or create `init.js` in your default text editor.

## Security boundaries

- Themes and init scripts run exclusively in the frontend WebView and do not modify the Rust backend.
- Network requests from providers continue to enforce HTTPS validation and host allowlists.
- GitHub authentication tokens remain securely isolated in the operating system credential store and are never exposed to custom scripts.
- File system access is restricted by Tauri capabilities to the app configuration and theme paths.
