# Settings backups

Open **Settings → Import and export** to save or load `updainium-settings.json`.
Backups contain tracked repository URLs, app identifiers, file and architecture
preferences, and startup/background settings. Release caches, downloaded files,
local file paths, and GitHub credentials are excluded. Imports validate the whole
backup before showing a preview. Merge keeps existing apps with matching URLs;
replace replaces the catalog after confirmation. Applying startup preferences is
optional. Review file preferences if the destination uses another operating system.
The versioned JSON format supports up to 5 MB.

## GitHub token connection

GitHub backups use a personal access token. Click **Create GitHub token** in
Settings to open GitHub's classic token creation page with the `gist` scope and
Updainium description selected. Choose an expiration, generate the token, paste
it into Settings, and click **Connect token**. A fine-grained token with Gists
read/write permission also works. No OAuth app registration is required.
See [GitHub's token documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

Tokens persist in this computer's OS credential store: macOS Keychain, Windows
Credential Manager, or Linux Secret Service. Linux needs an available Secret
Service (such as GNOME Keyring or KWallet). Saved credentials are loaded when
opening Settings, so restarting the app does not require signing in again.
Disconnect removes both saved and in-memory credentials. Tokens are never saved
in localStorage, sent to raw gist hosts, or included in JSON or gist exports.

## Gist migration

After connecting with a token, the app finds your existing Updainium backup gists.
Opening Settings does not contact GitHub: it reuses the list loaded earlier in
the current app session. After restarting the app, click **Load backups** to fetch
the list; click **Refresh** when you want to check for remote changes. If there
is only one, it becomes the main backup automatically. If there are several,
choose the main backup once; the choice is remembered locally per GitHub account.
Existing gists are never deleted or combined automatically.

With no existing backup, choose **Secret** or **Public** and click **Create backup**.
With a main backup selected, **Update backup** becomes the primary action. Updates
reuse the same gist, preserve its visibility, and retain older revisions in GitHub's
history. Before confirmation, the app fetches the latest update time. Before
uploading, it checks that the revision has not changed since that review; a newer
revision asks you to refresh and review again. The update is sent with the reviewed
revision's `If-Match` ETag and the returned history is re-checked, so a simultaneous
write from another device is reported instead of silently overwritten.

**Restore backup** loads revision history. Choose **Latest version** or a dated
older revision and click **Preview restore**. The existing import preview lets you
add missing apps or clean and replace the catalog, and optionally apply startup
preferences. Restoring an older version only changes local data; it does not rewind
the gist. **Open gist** opens the main backup in your default browser.

**Create a separate backup** is an optional action for a different app collection.
It becomes the main backup while the previous gist is kept. Secret gists are
unlisted but anyone with their link can read them; public gists are visible to
everyone and discoverable on GitHub.

To import someone else's catalog, paste a gist URL or ID under **Import from a
shared gist**, without signing in. Shared imports default to keeping your startup
preferences. Upload and restore are manual. Disconnecting removes the local
session and saved credentials without deleting gists or revoking the token on
GitHub. All GitHub requests show a cancellable progress dialog.

GitHub calls happen in the Rust backend to avoid WebView CORS restrictions.
Requests use HTTPS, timeouts, bounded responses, and disabled redirects.
See [GitHub's Gists API](https://docs.github.com/en/rest/gists/gists).

## Validation

```sh
node --test tests/*.test.mjs
npm run check
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Live token connection and gist operations require a real GitHub token. For a
manual check, export a catalog, merge and replace it from JSON, sign in, create a
gist, update the same gist after confirmation, and restore both the latest and
an older revision. Verify your main gist selection survives reopening Settings. Verify cancelling a file dialog
or import leaves the catalog untouched; malformed JSON shows an error; cancelling
restarting the app keeps your account connected;
both public and secret creation respect the chosen visibility; shared gist imports
work while disconnected; and disconnect requires signing in again.
