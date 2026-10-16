use crate::backup::{validate_backup_size, MAX_BACKUP_BYTES};
use futures_util::future::{AbortHandle, Abortable};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::State;

const FILE_NAME: &str = "updainium-settings.json";

#[derive(Clone)]
pub struct GithubState(
    Arc<Mutex<Session>>,
    Arc<dyn CredentialStore>,
    RequestRegistry,
);

/// Abort handles for every in-flight GitHub request, keyed by request ID, so
/// concurrent operations can be cancelled without overwriting each other.
#[derive(Clone, Default)]
struct RequestRegistry(Arc<Mutex<RequestRegistryInner>>);

#[derive(Default)]
struct RequestRegistryInner {
    next_id: u64,
    handles: HashMap<u64, AbortHandle>,
}

impl RequestRegistry {
    fn register(&self, abort: AbortHandle) -> Result<u64, String> {
        let mut inner = self
            .0
            .lock()
            .map_err(|_| "GitHub request state is unavailable.")?;
        inner.next_id = inner.next_id.wrapping_add(1);
        let id = inner.next_id;
        inner.handles.insert(id, abort);
        Ok(id)
    }

    fn remove(&self, id: u64) {
        if let Ok(mut inner) = self.0.lock() {
            inner.handles.remove(&id);
        }
    }

    fn cancel_all(&self) -> Result<(), String> {
        let aborts: Vec<AbortHandle> = {
            let inner = self
                .0
                .lock()
                .map_err(|_| "GitHub request state is unavailable.")?;
            inner.handles.values().cloned().collect()
        };
        // Abort outside the lock so task wakeups never deadlock against the registry.
        for abort in aborts {
            abort.abort();
        }
        Ok(())
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.0.lock().unwrap().handles.len()
    }
}

/// Removes this request's abort handle when the operation ends, even if the
/// surrounding task is dropped before the future completes.
struct RequestGuard {
    registry: RequestRegistry,
    id: u64,
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        self.registry.remove(self.id);
    }
}

async fn github_operation<T>(
    state: &GithubState,
    future: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let (abort, registration) = AbortHandle::new_pair();
    let _guard = RequestGuard {
        id: state.2.register(abort)?,
        registry: state.2.clone(),
    };
    Abortable::new(future, registration)
        .await
        .unwrap_or_else(|_| Err("GitHub request cancelled.".into()))
}

#[tauri::command]
pub fn github_cancel_request(state: State<'_, GithubState>) -> Result<(), String> {
    cancel_request(&state)
}

fn cancel_request(state: &GithubState) -> Result<(), String> {
    state.2.cancel_all()?;
    // Invalidate a token connection whose credential-save task has not started.
    // Do not block cancellation on an OS credential-store prompt already in progress.
    if let Ok(mut session) = state.0.try_lock() {
        session.generation = session.generation.wrapping_add(1);
    }
    Ok(())
}

impl Default for GithubState {
    fn default() -> Self {
        Self(
            Arc::default(),
            Arc::new(SystemCredentials),
            RequestRegistry::default(),
        )
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct SavedAccount {
    token: String,
    login: String,
}

trait CredentialStore: Send + Sync {
    fn load(&self) -> Result<Option<SavedAccount>, String>;
    fn save(&self, account: &SavedAccount) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

struct SystemCredentials;

impl CredentialStore for SystemCredentials {
    fn load(&self) -> Result<Option<SavedAccount>, String> {
        match credential_entry()?.get_password() {
            Ok(saved) => serde_json::from_str(&saved).map(Some)
                .map_err(|_| "Saved GitHub credentials are invalid. Disconnect and sign in again.".into()),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Could not read GitHub credentials. Unlock your system credential store and try again.".into()),
        }
    }
    fn save(&self, account: &SavedAccount) -> Result<(), String> {
        let saved = serde_json::to_string(account)
            .map_err(|_| "Could not prepare GitHub credentials for storage.")?;
        credential_entry()?.set_password(&saved)
            .map_err(|_| "Could not save GitHub credentials. Unlock your system credential store and try again.".into())
    }
    fn delete(&self) -> Result<(), String> {
        match credential_entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("The in-memory session was cleared, but saved credentials could not be removed. Unlock the credential store and disconnect again.".into()),
        }
    }
}

fn credential_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.livrasand.updainium.github", "github-account")
        .map_err(|_| "Could not access the system credential store.")
        .map_err(str::to_owned)
}

#[derive(Default)]
struct Session {
    token: Option<String>,
    login: Option<String>,
    generation: u64,
}

#[derive(Deserialize, Serialize)]
pub struct Account {
    login: String,
}

#[derive(Deserialize, Serialize)]
pub struct GistSummary {
    id: String,
    description: Option<String>,
    updated_at: String,
    public: bool,
}

#[derive(Deserialize, Serialize)]
pub struct GistRevision {
    version: String,
    committed_at: String,
}

#[derive(Serialize)]
pub struct BackupInfo {
    gist: GistSummary,
    revision: String,
}

fn revision_id(revision: &str) -> Result<(), String> {
    if revision.len() != 40 || !revision.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid gist revision.".into());
    }
    Ok(())
}

fn verify_revision(value: &Value, expected: &str) -> Result<(), String> {
    revision_id(expected)?;
    if value["history"][0]["version"].as_str() != Some(expected) {
        return Err("This backup changed on GitHub since you reviewed it. Refresh and review the latest update before uploading.".into());
    }
    Ok(())
}

/// Confirms that a completed update is still based on the reviewed revision.
///
/// GitHub does not document conditional (If-Match) support for the gist PATCH
/// endpoint, so a stale write can be applied even when the header is ignored.
/// The gist history is newest-first, so after our write the reviewed revision
/// must be the head (a no-op update) or its immediate parent (a normal update).
/// Anything else means another write landed between our read and our update.
fn verify_no_interleaving(value: &Value, expected: &str) -> Result<(), String> {
    let history = match value["history"].as_array() {
        Some(history) if !history.is_empty() => history,
        // Responses without history cannot be checked; If-Match guards the write
        // whenever GitHub honors it, so this is not treated as a conflict.
        _ => return Ok(()),
    };
    if history
        .iter()
        .take(2)
        .filter_map(|entry| entry["version"].as_str())
        .any(|version| version == expected)
    {
        return Ok(());
    }
    Err("This backup changed on GitHub while your update was uploading. The upload may have overwritten a newer revision; refresh and review the latest update.".into())
}

#[tauri::command]
pub async fn github_backup_info(
    state: State<'_, GithubState>,
    id: String,
) -> Result<BackupInfo, String> {
    github_operation(&state, async {
        gist_id(&id)?;
        let value = api(&token(&state)?, Method::GET, &format!("/gists/{id}"), None).await?;
        if !value["files"][FILE_NAME].is_object() {
            return Err("This gist is not an Updainium backup.".into());
        }
        let revision = value["history"][0]["version"]
            .as_str()
            .ok_or("GitHub did not return the current backup revision.")?
            .to_owned();
        revision_id(&revision)?;
        Ok(BackupInfo {
            gist: summary(value)?,
            revision,
        })
    })
    .await
}

#[tauri::command]
pub async fn github_backup_history(
    state: State<'_, GithubState>,
    id: String,
) -> Result<Vec<GistRevision>, String> {
    github_operation(&state, async {
        gist_id(&id)?;
        let token = token(&state)?;
        let mut history = Vec::new();
        for page in 1..=100 {
            let value = api(&token, Method::GET, &format!("/gists/{id}/commits?per_page=100&page={page}"), None).await?;
            let revisions: Vec<GistRevision> = serde_json::from_value(value).map_err(|_| "GitHub returned invalid revision history.")?;
            let complete = revisions.len() < 100;
            history.extend(revisions);
            if complete { return Ok(history); }
        }
        Err("This gist has too many revisions to list. Open the gist to browse its complete history.".into())
    }).await
}

fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Updainium")
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Could not initialize GitHub connection.".into())
}

struct ApiResponse {
    value: Value,
    etag: Option<String>,
}

async fn response_json(response: reqwest::Response) -> Result<ApiResponse, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => "GitHub credentials expired or are invalid. Sign in again.".into(),
            403 => "GitHub denied this request. Check gist permissions or try again after the rate limit resets.".into(),
            404 => "GitHub could not find this gist or you do not have access.".into(),
            412 => "This backup changed on GitHub since you reviewed it. Refresh and review the latest update before uploading.".into(),
            _ => format!("GitHub request failed (HTTP {status})."),
        });
    }
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read GitHub response.")?
    {
        if bytes.len() + chunk.len() > MAX_BACKUP_BYTES * 2 {
            return Err("GitHub response is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value = serde_json::from_slice(&bytes)
        .map_err(|_| "GitHub returned an unreadable response.".to_owned())?;
    Ok(ApiResponse { value, etag })
}

async fn api(
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    api_conditional(token, method, path, body, None)
        .await
        .map(|response| response.value)
}

async fn api_conditional(
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
    if_match: Option<&str>,
) -> Result<ApiResponse, String> {
    let mut request = client()?
        .request(method, format!("https://api.github.com{path}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if !token.is_empty() {
        request = request.bearer_auth(token);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }
    if let Some(if_match) = if_match {
        request = request.header(reqwest::header::IF_MATCH, if_match);
    }
    response_json(
        request
            .send()
            .await
            .map_err(|_| "Could not connect to GitHub. Check your connection.")?,
    )
    .await
}

async fn account(token: &str) -> Result<Account, String> {
    serde_json::from_value(api(token, Method::GET, "/user", None).await?)
        .map_err(|_| "GitHub returned invalid account information.".into())
}

fn token(state: &GithubState) -> Result<String, String> {
    state
        .0
        .lock()
        .map_err(|_| "GitHub session is unavailable.")?
        .token
        .clone()
        .ok_or_else(|| "Sign in to GitHub first.".into())
}

/// Returns the signed-in login without an extra `/user` round-trip, keeping the
/// gap between reading a gist and updating it as small as possible.
fn login(state: &GithubState) -> Result<String, String> {
    state
        .0
        .lock()
        .map_err(|_| "GitHub session is unavailable.")?
        .login
        .clone()
        .ok_or_else(|| "Sign in to GitHub first.".into())
}

fn gist_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid gist ID.".into());
    }
    Ok(())
}

async fn store_account(
    state: &GithubState,
    token: String,
    account: &Account,
    generation: u64,
) -> Result<(), String> {
    let state = state.clone();
    let login = account.login.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = state
            .0
            .lock()
            .map_err(|_| "GitHub session is unavailable.")?;
        if session.generation != generation {
            return Err("GitHub sign-in was cancelled.".into());
        }
        state.1.save(&SavedAccount {
            token: token.clone(),
            login: login.clone(),
        })?;
        session.token = Some(token);
        session.login = Some(login);
        Ok(())
    })
    .await
    .map_err(|_| "Could not save GitHub credentials.".to_owned())?
}

#[tauri::command]
pub async fn github_status(state: State<'_, GithubState>) -> Result<Option<Account>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || restore_saved_session(&state))
        .await
        .map_err(|_| "Could not load GitHub credentials.".to_owned())?
}

fn restore_saved_session(state: &GithubState) -> Result<Option<Account>, String> {
    let mut session = state
        .0
        .lock()
        .map_err(|_| "GitHub session is unavailable.")?;
    if session.token.is_none() {
        if let Some(saved) = state.1.load()? {
            session.token = Some(saved.token);
            session.login = Some(saved.login);
        }
    }
    Ok(session.login.clone().map(|login| Account { login }))
}

#[tauri::command]
pub async fn github_disconnect(state: State<'_, GithubState>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || disconnect_session(&state))
        .await
        .map_err(|_| "Could not remove GitHub credentials.".to_owned())?
}

fn disconnect_session(state: &GithubState) -> Result<(), String> {
    let mut session = state
        .0
        .lock()
        .map_err(|_| "GitHub session is unavailable.")?;
    let generation = session.generation.wrapping_add(1);
    *session = Session {
        generation,
        ..Default::default()
    };
    state.1.delete()
}

#[tauri::command]
pub async fn github_connect_token(
    state: State<'_, GithubState>,
    access_token: String,
) -> Result<Account, String> {
    github_operation(&state, async {
        let access_token = access_token.trim().to_owned();
        if access_token.is_empty() || access_token.len() > 512 {
            return Err("Enter a valid GitHub token.".into());
        }
        let generation = {
            let mut session = state
                .0
                .lock()
                .map_err(|_| "GitHub session is unavailable.")?;
            session.generation = session.generation.wrapping_add(1);
            session.generation
        };
        let account = account(&access_token).await?;
        store_account(&state, access_token, &account, generation).await?;
        Ok(account)
    })
    .await
}

fn summary(value: Value) -> Result<GistSummary, String> {
    serde_json::from_value(value).map_err(|_| "GitHub returned invalid gist information.".into())
}

fn gist_write_payload(content: &str, visibility: Option<bool>) -> Value {
    let mut body = json!({ "description": "Updainium settings backup",
        "files": { FILE_NAME: { "content": content } } });
    if let Some(public) = visibility {
        body["public"] = json!(public);
    }
    body
}

#[tauri::command]
pub async fn github_list_backups(
    state: State<'_, GithubState>,
) -> Result<Vec<GistSummary>, String> {
    github_operation(&state, async {
        let token = token(&state)?;
        let mut backups = Vec::new();
        // Paginate so backups are discoverable even on accounts with many gists.
        for page in 1..=100 {
            let value = api(
                &token,
                Method::GET,
                &format!("/gists?per_page=100&page={page}"),
                None,
            )
            .await?;
            let gists = value
                .as_array()
                .ok_or("GitHub returned an invalid gist list.")?;
            for gist in gists {
                if gist["files"][FILE_NAME].is_object() {
                    backups.push(summary(gist.clone())?);
                }
            }
            if gists.len() < 100 {
                return Ok(backups);
            }
        }
        Err("Too many gists to list. Use a gist ID to restore your backup.".into())
    })
    .await
}

#[tauri::command]
pub async fn github_read_backup(
    state: State<'_, GithubState>,
    id: String,
    revision: Option<String>,
) -> Result<String, String> {
    github_operation(&state, async {
        gist_id(&id)?;
        // Public and secret gists are readable by ID without an account, including shared catalogs.
        let path = if let Some(revision) = revision {
            revision_id(&revision)?;
            format!("/gists/{id}/{revision}")
        } else {
            format!("/gists/{id}")
        };
        let value = api("", Method::GET, &path, None).await?;
        let file = &value["files"][FILE_NAME];
        if file["truncated"].as_bool() == Some(true) {
            let raw_url = file["raw_url"]
                .as_str()
                .ok_or("GitHub did not provide the full backup URL.")?;
            let url = reqwest::Url::parse(raw_url).map_err(|_| "Invalid GitHub backup URL.")?;
            if url.scheme() != "https"
                || url.host_str() != Some("gist.githubusercontent.com")
                || !url.username().is_empty()
                || url.password().is_some()
                || url.port().is_some()
            {
                return Err("GitHub returned an unexpected backup URL.".into());
            }
            // Secret gist raw URLs are readable without authorization. Never send the token to a second host.
            let mut response = client()?
                .get(url)
                .send()
                .await
                .map_err(|_| "Could not download the full gist backup.")?;
            if !response.status().is_success() {
                return Err(
                    "Could not download the full gist backup. Import the JSON file instead.".into(),
                );
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "Could not read the gist backup.")?
            {
                if bytes.len() + chunk.len() > MAX_BACKUP_BYTES {
                    return Err("Backup exceeds the 5 MB limit.".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            return String::from_utf8(bytes).map_err(|_| "Gist backup is not valid UTF-8.".into());
        }
        let content = file["content"]
            .as_str()
            .ok_or("This gist does not contain an Updainium backup.")?
            .to_owned();
        validate_backup_size(&content)?;
        Ok(content)
    })
    .await
}

#[tauri::command]
pub async fn github_write_backup(
    state: State<'_, GithubState>,
    id: Option<String>,
    content: String,
    is_public: bool,
    expected_revision: Option<String>,
) -> Result<GistSummary, String> {
    github_operation(&state, async {
        validate_backup_size(&content)?;
        let token = token(&state)?;
        let body = gist_write_payload(&content, id.is_none().then_some(is_public));
        let value = if let Some(id) = id {
            gist_id(&id)?;
            let expected = expected_revision
                .as_deref()
                .ok_or("Review the latest backup before updating it.")?;
            let existing =
                api_conditional(&token, Method::GET, &format!("/gists/{id}"), None, None).await?;
            verify_revision(&existing.value, expected)?;
            if !existing.value["files"][FILE_NAME].is_object() {
                return Err("This gist is not an Updainium backup.".into());
            }
            if existing.value["owner"]["login"].as_str() != Some(login(&state)?.as_str()) {
                return Err("You can only update your own backup gists.".into());
            }
            // Send the reviewed revision's ETag so GitHub can reject a write that
            // raced with another client (HTTP 412). GitHub only honors conditional
            // requests on some endpoints, so re-check the returned history afterwards
            // to catch a clobber when the header is ignored.
            let etag = existing
                .etag
                .ok_or("GitHub did not return the current backup revision.")?;
            let updated = api_conditional(
                &token,
                Method::PATCH,
                &format!("/gists/{id}"),
                Some(body),
                Some(&etag),
            )
            .await?;
            verify_no_interleaving(&updated.value, expected)?;
            updated.value
        } else {
            api(&token, Method::POST, "/gists", Some(body)).await?
        };
        summary(value)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_checks_reject_invalid_paths_and_stale_updates() {
        let current = "a".repeat(40);
        let older = "b".repeat(40);
        let gist = json!({ "history": [{ "version": current }] });
        assert!(verify_revision(&gist, &current).is_ok());
        assert!(verify_revision(&gist, &older)
            .unwrap_err()
            .contains("changed on GitHub"));
        assert!(verify_revision(&json!({}), &current).is_err());
        for revision in ["", "../other", "abc?token=x", "abcd"] {
            assert!(revision_id(revision).is_err());
        }
    }

    #[test]
    fn interleaving_check_accepts_our_update_and_flags_concurrent_writes() {
        let base = "a".repeat(40);
        let ours = "b".repeat(40);
        let theirs = "c".repeat(40);
        // Normal update: our new revision sits on top of the reviewed one.
        let updated = json!({ "history": [{ "version": ours }, { "version": base }] });
        assert!(verify_no_interleaving(&updated, &base).is_ok());
        // No-op update: the reviewed revision is still the head.
        let unchanged = json!({ "history": [{ "version": base }] });
        assert!(verify_no_interleaving(&unchanged, &base).is_ok());
        // Another write landed between our read and our update.
        let clobbered = json!({ "history": [
            { "version": ours },
            { "version": theirs },
            { "version": base }
        ] });
        assert!(verify_no_interleaving(&clobbered, &base)
            .unwrap_err()
            .contains("while your update was uploading"));
        // A response without history cannot be verified and is not a conflict.
        assert!(verify_no_interleaving(&json!({}), &base).is_ok());
        assert!(verify_no_interleaving(&json!({ "history": [] }), &base).is_ok());
    }

    #[test]
    fn cancel_stops_pending_request_and_allows_next_request() {
        let state = GithubState(
            Arc::default(),
            Arc::new(TestCredentials::default()),
            RequestRegistry::default(),
        );
        tauri::async_runtime::block_on(async {
            let waiting = github_operation(&state, std::future::pending::<Result<(), String>>());
            let cancelling = async {
                cancel_request(&state).unwrap();
            };
            let (result, ()) = futures_util::join!(waiting, cancelling);
            assert_eq!(result.unwrap_err(), "GitHub request cancelled.");
            assert_eq!(state.0.lock().unwrap().generation, 1);
            assert_eq!(state.2.len(), 0);
            assert_eq!(github_operation(&state, async { Ok(7) }).await.unwrap(), 7);
        });
    }

    #[test]
    fn concurrent_requests_keep_independent_cancel_handles() {
        let state = GithubState(
            Arc::default(),
            Arc::new(TestCredentials::default()),
            RequestRegistry::default(),
        );
        tauri::async_runtime::block_on(async {
            let first = github_operation(&state, std::future::pending::<Result<(), String>>());
            let second = github_operation(&state, std::future::pending::<Result<(), String>>());
            let inspect = async {
                // Both requests are registered; finishing one must not clear the other.
                assert_eq!(state.2.len(), 2);
                assert_eq!(github_operation(&state, async { Ok(7) }).await.unwrap(), 7);
                assert_eq!(state.2.len(), 2);
                cancel_request(&state).unwrap();
            };
            let (first, second, ()) = futures_util::join!(first, second, inspect);
            assert_eq!(first.unwrap_err(), "GitHub request cancelled.");
            assert_eq!(second.unwrap_err(), "GitHub request cancelled.");
            assert_eq!(state.2.len(), 0);
        });
    }

    #[test]
    fn gist_creation_respects_visibility_and_updates_preserve_it() {
        let secret = gist_write_payload("backup-json", Some(false));
        let public = gist_write_payload("backup-json", Some(true));
        let update = gist_write_payload("backup-json", None);
        assert_eq!(secret["public"], false);
        assert_eq!(public["public"], true);
        assert!(update.get("public").is_none());
        assert_eq!(update["files"][FILE_NAME]["content"], "backup-json");
        assert_eq!(update["files"].as_object().unwrap().len(), 1);
    }

    #[derive(Default)]
    struct TestCredentials(Mutex<Option<SavedAccount>>);
    impl CredentialStore for TestCredentials {
        fn load(&self) -> Result<Option<SavedAccount>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn save(&self, account: &SavedAccount) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(account.clone());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    #[test]
    fn sign_in_survives_restart_and_disconnect_removes_saved_credentials() {
        let credentials = Arc::new(TestCredentials::default());
        let first = GithubState(Arc::default(), credentials.clone(), RequestRegistry::default());
        tauri::async_runtime::block_on(store_account(
            &first,
            "test-token".into(),
            &Account {
                login: "alice".into(),
            },
            0,
        ))
        .unwrap();
        drop(first);
        let restarted = GithubState(Arc::default(), credentials.clone(), RequestRegistry::default());
        assert_eq!(
            restore_saved_session(&restarted).unwrap().unwrap().login,
            "alice"
        );
        assert_eq!(token(&restarted).unwrap(), "test-token");
        disconnect_session(&restarted).unwrap();
        assert!(token(&restarted).is_err());
        let after_disconnect = GithubState(Arc::default(), credentials, RequestRegistry::default());
        assert!(restore_saved_session(&after_disconnect).unwrap().is_none());
    }

    #[test]
    fn cancelled_sign_in_cannot_save_credentials() {
        let credentials = Arc::new(TestCredentials::default());
        let state = GithubState(Arc::default(), credentials.clone(), RequestRegistry::default());
        state.0.lock().unwrap().generation = 1;
        assert!(tauri::async_runtime::block_on(store_account(
            &state,
            "test-token".into(),
            &Account {
                login: "alice".into()
            },
            0
        ))
        .is_err());
        assert!(credentials.load().unwrap().is_none());
        assert!(token(&state).is_err());
    }

    #[test]
    fn rejects_gist_path_injection() {
        assert!(gist_id("abc123").is_ok());
        for id in [
            "",
            "../user",
            "abc?token=x",
            "https://github.com",
            "abc/def",
        ] {
            assert!(gist_id(id).is_err());
        }
    }
}
