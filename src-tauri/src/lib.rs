use std::{fs, io::Write, process::Command};
use sha2::{Digest, Sha256};
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_autostart::MacosLauncher;

#[derive(serde::Serialize)]
struct Platform {
    os: &'static str,
    arch: &'static str,
}

#[derive(serde::Serialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
    sha256: Option<String>,
}

#[derive(serde::Serialize)]
struct Release {
    tag_name: Option<String>,
    name: Option<String>,
    assets: Vec<ReleaseAsset>,
}

#[derive(serde::Serialize)]
struct DownloadedAsset {
    path: String,
    sha256: String,
    verified: bool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let app_menu = Submenu::new(app, "Updainium", true)?;
            app.set_menu(Menu::with_items(app, &[&app_menu])?)?;

            let open = MenuItem::with_id(app, "open", "Open Updainium", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let icon = app.default_window_icon().cloned().expect("default window icon is configured");

            TrayIconBuilder::with_id("main")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            app.tray_by_id("main").expect("tray icon was just created").set_visible(false)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_platform,
            set_background_mode,
            identify_installed_app_identifier,
            identify_app_identifier_from_path,
            get_installed_app_version,
            download_release_asset,
            fetch_release_metadata,
            fetch_repository_icon
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn set_background_mode(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    app.tray_by_id("main")
        .ok_or_else(|| "The system tray is unavailable.".to_string())?
        .set_visible(enabled)
        .map_err(|error| error.to_string())
}

fn https_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            if url.scheme() == "https" && url.host_str().is_some() {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|error| error.to_string())
}

fn parse_https_url(url: &str, rejection: &'static str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err(rejection.into());
    }
    Ok(parsed)
}

fn string_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

fn sha256_field(value: &serde_json::Value) -> Option<String> {
    let digest = string_field(value, "digest").or_else(|| string_field(value, "sha256"))?;
    let digest = digest.strip_prefix("sha256:").unwrap_or(&digest);
    (digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| digest.to_ascii_lowercase())
}

/// GitHub, Gitea and Forgejo expose assets as an array of objects using
/// `browser_download_url`; GitLab nests them under `assets.links` and calls the
/// download field `direct_asset_url`.
fn normalize_release(payload: serde_json::Value) -> Release {
    let payload = match payload {
        serde_json::Value::Array(mut items) if !items.is_empty() => items.remove(0),
        other => other,
    };

    let tag_name = string_field(&payload, "tag_name");
    let name = string_field(&payload, "name");

    let mut assets = Vec::new();
    match payload.get("assets") {
        Some(serde_json::Value::Array(items)) => {
            for item in items {
                let asset_name = string_field(item, "name");
                let url = string_field(item, "browser_download_url");
                if let (Some(asset_name), Some(url)) = (asset_name, url) {
                    assets.push(ReleaseAsset {
                        name: asset_name,
                        browser_download_url: url,
                        sha256: sha256_field(item),
                    });
                }
            }
        }
        Some(serde_json::Value::Object(_)) => {
            if let Some(links) = payload
                .get("assets")
                .and_then(|assets| assets.get("links"))
                .and_then(serde_json::Value::as_array)
            {
                for link in links {
                    let asset_name = string_field(link, "name");
                    let url = string_field(link, "direct_asset_url")
                        .or_else(|| string_field(link, "url"));
                    if let (Some(asset_name), Some(url)) = (asset_name, url) {
                        assets.push(ReleaseAsset {
                            name: asset_name,
                            browser_download_url: url,
                            sha256: sha256_field(link),
                        });
                    }
                }
            }
        }
        _ => {}
    }

    Release {
        tag_name,
        name,
        assets,
    }
}

/// Fetches release metadata from the backend instead of the WebView: forge APIs
/// do not send `Access-Control-Allow-Origin`, so a `fetch()` from the Tauri page
/// is rejected by WebKit even when the server is reachable.
#[tauri::command]
async fn fetch_release_metadata(api_urls: Vec<String>) -> Result<Release, String> {
    if api_urls.is_empty() {
        return Err("No release API endpoint could be derived from the URL.".into());
    }

    let client = https_client()?;
    let mut not_found = false;
    let mut transport_error: Option<String> = None;

    for api_url in api_urls {
        let parsed_url = match parse_https_url(&api_url, "The release API must be reached over HTTPS.") {
            Ok(parsed_url) => parsed_url,
            Err(error) => {
                transport_error = Some(error);
                continue;
            }
        };

        let response = match client
            .get(parsed_url)
            .header(reqwest::header::USER_AGENT, "Updainium")
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                transport_error = Some(error.to_string());
                continue;
            }
        };

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            not_found = true;
            continue;
        }
        if !status.is_success() {
            return Err(format!("The release API responded with status {status}."));
        }

        let payload: serde_json::Value = response
            .json()
            .await
            .map_err(|error| format!("The release API returned unreadable data: {error}"))?;
        return Ok(normalize_release(payload));
    }

    if not_found {
        return Err("The repository has no published releases or is not accessible.".into());
    }
    Err(transport_error
        .unwrap_or_else(|| "The release API could not be reached.".into()))
}

#[tauri::command]
async fn fetch_repository_icon(api_url: String) -> Result<Option<String>, String> {
    let parsed_url = parse_https_url(&api_url, "The repository API must be reached over HTTPS.")?;
    let payload: serde_json::Value = https_client()?
        .get(parsed_url)
        .header(reqwest::header::USER_AGENT, "Updainium")
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| format!("The repository API returned unreadable data: {error}"))?;

    let icon_url = payload
        .get("avatar_url")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            payload
                .get("owner")
                .and_then(|owner| owner.get("avatar_url"))
                .and_then(serde_json::Value::as_str)
        });
    match icon_url {
        Some(url) => parse_https_url(url, "The repository icon must come from an HTTPS source.")
            .map(|url| Some(url.to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
fn get_platform() -> Platform {
    Platform {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[tauri::command]
fn identify_installed_app_identifier(app_name: String) -> Result<Option<String>, String> {
    let normalized_name = normalized_app_name(&app_name);
    if normalized_name.is_empty() {
        return Err("Enter a repository name to identify the installed app.".into());
    }

    #[cfg(target_os = "macos")]
    {
        return identify_macos_app_identifier(&app_name, &normalized_name);
    }
    #[cfg(target_os = "windows")]
    {
        return identify_windows_app_identifier(&normalized_name);
    }
    #[cfg(target_os = "linux")]
    {
        return identify_linux_app_identifier(&normalized_name);
    }
    #[allow(unreachable_code)]
    Err("Installed app identification is not supported on this operating system.".into())
}

#[tauri::command]
fn identify_app_identifier_from_path(path: String) -> Result<String, String> {
    let path = std::path::Path::new(&path);
    if !path.exists() {
        return Err("The selected app file does not exist.".into());
    }

    #[cfg(target_os = "macos")]
    {
        return identify_macos_app_identifier_from_path(path);
    }
    #[cfg(target_os = "windows")]
    {
        return identify_windows_app_identifier_from_path(path);
    }
    #[cfg(target_os = "linux")]
    {
        return identify_linux_app_identifier_from_path(path);
    }
    #[allow(unreachable_code)]
    Err("App identification from a file is not supported on this operating system.".into())
}

fn normalized_app_name(name: &str) -> String {
    name.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

fn unique_identifier(mut identifiers: Vec<String>) -> Option<String> {
    identifiers.sort();
    identifiers.dedup();
    (identifiers.len() == 1).then(|| identifiers.remove(0))
}

#[cfg(target_os = "macos")]
fn identify_macos_app_identifier_from_path(path: &std::path::Path) -> Result<String, String> {
    let app_path = path
        .ancestors()
        .find(|ancestor| ancestor.extension().is_some_and(|extension| extension == "app"))
        .ok_or_else(|| "Select an installed .app bundle or a file inside it.".to_owned())?;
    let info = app_path.join("Contents/Info.plist");
    read_macos_plist_value(
        info.to_str()
            .ok_or_else(|| "The selected app path is not valid.".to_owned())?,
        "CFBundleIdentifier",
    )
    .ok_or_else(|| "The selected app does not contain a bundle identifier.".to_owned())
}

#[cfg(target_os = "windows")]
fn identify_windows_app_identifier_from_path(path: &std::path::Path) -> Result<String, String> {
    let selected_path = normalized_windows_path(path.to_string_lossy().as_ref());
    let roots = [
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    let mut identifiers = Vec::new();
    for root in roots {
        let output = Command::new("reg")
            .args(["query", root, "/s"])
            .output()
            .map_err(|error| error.to_string())?;
        let mut key = String::new();
        let mut install_location = String::new();
        let mut display_icon = String::new();
        let mut matches_path = false;
        let mut collect_entry = |key: &str, matches_path: bool| {
            if matches_path {
                if let Some(identifier) = key.rsplit('\\').next() {
                    identifiers.push(identifier.to_owned());
                }
            }
        };
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("HKEY_") {
                collect_entry(&key, matches_path);
                key = trimmed.to_owned();
                install_location.clear();
                display_icon.clear();
                matches_path = false;
                continue;
            }
            let fields: Vec<&str> = trimmed.split_whitespace().collect();
            if fields.len() < 3 || !fields[1].starts_with("REG_") {
                continue;
            }
            let value = fields[2..].join(" ");
            match fields[0] {
                "InstallLocation" => {
                    install_location = value;
                    let candidate = normalized_windows_path(&install_location);
                    matches_path |= !candidate.is_empty()
                        && (selected_path == candidate
                            || selected_path.starts_with(&format!("{candidate}\\")));
                }
                "DisplayIcon" => {
                    display_icon = value;
                    let candidate = normalized_windows_path(&display_icon);
                    matches_path |= selected_path == candidate;
                }
                _ => {}
            }
        }
        collect_entry(&key, matches_path);
        drop(collect_entry);
    }
    unique_identifier(identifiers)
        .ok_or_else(|| "The selected executable did not match a unique installed app entry.".into())
}

#[cfg(target_os = "windows")]
fn normalized_windows_path(path: &str) -> String {
    let path = path.trim().trim_matches('"');
    let path = path
        .rsplit_once(',')
        .filter(|(_, suffix)| suffix.trim().parse::<u32>().is_ok())
        .map_or(path, |(path, _)| path);
    path.trim().trim_matches('"').replace('/', "\\").to_lowercase()
}

#[cfg(target_os = "linux")]
fn identify_linux_app_identifier_from_path(path: &std::path::Path) -> Result<String, String> {
    let path = path
        .canonicalize()
        .map_err(|error| format!("Could not resolve the selected app file: {error}"))?;
    let path = path
        .to_str()
        .ok_or_else(|| "The selected app path is not valid.".to_owned())?;

    let mut identifiers = Vec::new();
    match Command::new("dpkg-query")
        .args(["--search", "--", path])
        .output()
    {
        Ok(output) if output.status.success() => {
            identifiers.extend(
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .filter_map(|line| line.split_once(": ").map(|(package, _)| package))
                    .map(|package| package.split(':').next().unwrap_or(package).to_owned()),
            );
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }

    match Command::new("rpm")
        .args(["-qf", "--qf", "%{NAME}\n", "--", path])
        .output()
    {
        Ok(output) if output.status.success() => {
            identifiers.extend(
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .map(str::to_owned),
            );
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }

    unique_identifier(identifiers)
        .ok_or_else(|| "The selected file is not owned by a unique installed package.".into())
}

#[cfg(target_os = "macos")]
fn identify_macos_app_identifier(
    app_name: &str,
    normalized_name: &str,
) -> Result<Option<String>, String> {
    let mut app_directories = vec!["/Applications".to_owned()];
    if let Some(home) = std::env::var_os("HOME") {
        app_directories.push(
            std::path::PathBuf::from(home)
                .join("Applications")
                .to_string_lossy()
                .into_owned(),
        );
    }

    let mut identifiers = Vec::new();
    for directory in app_directories {
        let matches = Command::new("mdfind")
            .args(["-onlyin", &directory, "-name", app_name])
            .output()
            .map_err(|error| error.to_string())?;
        for path in String::from_utf8_lossy(&matches.stdout).lines() {
            if !path.ends_with(".app") {
                continue;
            }
            let info = format!("{path}/Contents/Info.plist");
            let names = [
                path.rsplit('/')
                    .next()
                    .unwrap_or("")
                    .trim_end_matches(".app")
                    .to_owned(),
                read_macos_plist_value(&info, "CFBundleDisplayName").unwrap_or_default(),
                read_macos_plist_value(&info, "CFBundleName").unwrap_or_default(),
            ];
            if names
                .iter()
                .any(|name| normalized_app_name(name) == normalized_name)
            {
                if let Some(identifier) = read_macos_plist_value(&info, "CFBundleIdentifier") {
                    identifiers.push(identifier);
                }
            }
        }
    }

    if let Ok(packages) = Command::new("pkgutil").arg("--pkgs").output() {
        for identifier in String::from_utf8_lossy(&packages.stdout).lines() {
            if normalized_app_name(identifier).ends_with(normalized_name) {
                identifiers.push(identifier.to_owned());
            }
        }
    }
    Ok(unique_identifier(identifiers))
}

#[cfg(target_os = "macos")]
fn read_macos_plist_value(info: &str, key: &str) -> Option<String> {
    let output = Command::new("defaults")
        .args(["read", info, key])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!value.is_empty()).then_some(value)
}

#[cfg(target_os = "windows")]
fn identify_windows_app_identifier(app_name: &str) -> Result<Option<String>, String> {
    let roots = [
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    let mut identifiers = Vec::new();
    for root in roots {
        let output = Command::new("reg")
            .args(["query", root, "/s", "/v", "DisplayName"])
            .output()
            .map_err(|error| error.to_string())?;
        let mut key = String::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("HKEY_") {
                key = trimmed.to_owned();
            } else {
                let fields: Vec<&str> = trimmed.split_whitespace().collect();
                if fields.len() >= 3
                    && fields[1].starts_with("REG_")
                    && normalized_app_name(&fields[2..].join(" ")) == app_name
                {
                    if let Some(identifier) = key.rsplit('\\').next() {
                        identifiers.push(identifier.to_owned());
                    }
                }
            }
        }
    }
    Ok(unique_identifier(identifiers))
}

#[cfg(target_os = "linux")]
fn identify_linux_app_identifier(app_name: &str) -> Result<Option<String>, String> {
    let mut package_manager_found = false;
    let mut identifiers = Vec::new();

    let dpkg = Command::new("dpkg-query")
        .args([
            "--show",
            "--showformat=${binary:Package}\t${db:Status-Status}\n",
        ])
        .output();
    match dpkg {
        Ok(output) => {
            package_manager_found = true;
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let Some((package, status)) = line.split_once('\t') else {
                    continue;
                };
                let package_name = package.split(':').next().unwrap_or(package);
                if status == "installed" && normalized_app_name(package_name) == app_name {
                    identifiers.push(package_name.to_owned());
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }

    let rpm = Command::new("rpm")
        .args(["-qa", "--qf", "%{NAME}\n"])
        .output();
    match rpm {
        Ok(output) => {
            package_manager_found = true;
            for package in String::from_utf8_lossy(&output.stdout).lines() {
                if normalized_app_name(package) == app_name {
                    identifiers.push(package.to_owned());
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }

    if package_manager_found {
        Ok(unique_identifier(identifiers))
    } else {
        Err("No supported package manager is available for app identification.".into())
    }
}

#[tauri::command]
fn get_installed_app_version(identifier: String) -> Result<Option<String>, String> {
    if identifier.is_empty()
        || !identifier
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || " .-_{}+~:@".contains(character))
    {
        return Err("The app/package identifier contains unsupported characters.".into());
    }

    #[cfg(target_os = "macos")]
    {
        return installed_macos_version(&identifier);
    }
    #[cfg(target_os = "windows")]
    {
        return installed_windows_version(&identifier);
    }
    #[cfg(target_os = "linux")]
    {
        return installed_linux_version(&identifier);
    }
    #[allow(unreachable_code)]
    Err("Installed app detection is not supported on this operating system.".into())
}

#[cfg(target_os = "macos")]
fn installed_macos_version(identifier: &str) -> Result<Option<String>, String> {
    let query = format!("kMDItemCFBundleIdentifier == '{identifier}'");
    let mut app_directories = vec!["/Applications".to_owned()];
    if let Some(home) = std::env::var_os("HOME") {
        app_directories.push(
            std::path::PathBuf::from(home)
                .join("Applications")
                .to_string_lossy()
                .into_owned(),
        );
    }
    for directory in app_directories {
        let matches = Command::new("mdfind")
            .args(["-onlyin", &directory, &query])
            .output()
            .map_err(|error| error.to_string())?;
        for path in String::from_utf8_lossy(&matches.stdout).lines() {
            if !path.ends_with(".app") {
                continue;
            }
            let info = format!("{path}/Contents/Info.plist");
            for key in ["CFBundleShortVersionString", "CFBundleVersion"] {
                if let Ok(output) = Command::new("defaults").args(["read", &info, key]).output() {
                    if output.status.success() {
                        let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                        if !version.is_empty() {
                            return Ok(Some(version));
                        }
                    }
                }
            }
            return Ok(Some(String::new()));
        }
    }

    let package = Command::new("pkgutil")
        .args(["--pkg-info", identifier])
        .output()
        .map_err(|error| error.to_string())?;
    if package.status.success() {
        let version = String::from_utf8_lossy(&package.stdout)
            .lines()
            .find_map(|line| line.strip_prefix("version:"))
            .unwrap_or("")
            .trim()
            .to_owned();
        return Ok(Some(version));
    }
    Ok(None)
}

#[cfg(target_os = "windows")]
fn installed_windows_version(identifier: &str) -> Result<Option<String>, String> {
    let roots = [
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    for root in roots {
        let key = format!(r"{root}\{identifier}");
        let entry = Command::new("reg")
            .args(["query", &key])
            .output()
            .map_err(|error| error.to_string())?;
        if !entry.status.success() {
            continue;
        }
        let version = Command::new("reg")
            .args(["query", &key, "/v", "DisplayVersion"])
            .output()
            .map_err(|error| error.to_string())?;
        let value = String::from_utf8_lossy(&version.stdout)
            .lines()
            .find(|line| line.contains("DisplayVersion"))
            .and_then(|line| line.split_whitespace().last())
            .unwrap_or("")
            .to_owned();
        return Ok(Some(value));
    }
    Ok(None)
}

#[cfg(target_os = "linux")]
fn installed_linux_version(identifier: &str) -> Result<Option<String>, String> {
    let mut package_manager_found = false;
    let dpkg = Command::new("dpkg-query")
        .args(["--show", "--showformat=${Version}", "--", identifier])
        .output();
    match dpkg {
        Ok(output) => {
            package_manager_found = true;
            if output.status.success() {
                return Ok(Some(
                    String::from_utf8_lossy(&output.stdout).trim().to_owned(),
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let rpm = Command::new("rpm")
        .args(["-q", "--qf", "%{VERSION}", "--", identifier])
        .output();
    match rpm {
        Ok(output) => {
            package_manager_found = true;
            if output.status.success() {
                return Ok(Some(
                    String::from_utf8_lossy(&output.stdout).trim().to_owned(),
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    if package_manager_found {
        Ok(None)
    } else {
        Err("No supported package manager is available for app detection.".into())
    }
}

#[tauri::command]
async fn download_release_asset(
    app: tauri::AppHandle,
    url: String,
    file_name: String,
    expected_sha256: Option<String>,
) -> Result<DownloadedAsset, String> {
    let parsed_url = parse_https_url(&url, "The download must come from an HTTPS source.")?;
    let expected_sha256 = expected_sha256
        .map(|digest| {
            let normalized = digest.strip_prefix("sha256:").unwrap_or(&digest);
            if normalized.len() == 64
                && normalized.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                Ok(normalized.to_ascii_lowercase())
            } else {
                Err("The published SHA-256 checksum is invalid.".to_owned())
            }
        })
        .transpose()?;

    let safe_name: String = file_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    if safe_name.is_empty() || safe_name.starts_with('.') {
        return Err("The installer file name is not valid.".into());
    }

    let client = https_client()?;
    let mut response = client
        .get(parsed_url)
        .header(reqwest::header::USER_AGENT, "Updainium")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;

    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let destination = directory.join(safe_name);
    let temporary = destination.with_extension("download");
    let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|error| error.to_string())?;
    }
    file.sync_all().map_err(|error| error.to_string())?;
    let sha256 = format!("{:x}", hasher.finalize());
    if let Some(expected_sha256) = expected_sha256.as_deref() {
        if sha256 != expected_sha256 {
            let _ = fs::remove_file(&temporary);
            return Err(format!(
                "The downloaded file failed SHA-256 verification. Expected {expected_sha256}, got {sha256}."
            ));
        }
    }
    if destination.exists() {
        fs::remove_file(&destination).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    if destination
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("appimage"))
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;
    }

    let path = destination
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "The local installer path is not valid.".to_owned())?;
    Ok(DownloadedAsset {
        path,
        sha256,
        verified: expected_sha256.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_codeberg_style_assets() {
        let release = normalize_release(serde_json::json!({
            "tag_name": "3.3.0",
            "name": "Gram 3.3.0",
            "assets": [
                {
                    "name": "Gram-x86_64-3.3.0.dmg",
                    "browser_download_url": "https://codeberg.org/g/r/releases/download/3.3.0/Gram-x86_64-3.3.0.dmg",
                    "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                }
            ]
        }));

        assert_eq!(release.tag_name.as_deref(), Some("3.3.0"));
        assert_eq!(release.name.as_deref(), Some("Gram 3.3.0"));
        assert_eq!(release.assets.len(), 1);
        assert_eq!(release.assets[0].name, "Gram-x86_64-3.3.0.dmg");
        assert_eq!(
            release.assets[0].browser_download_url,
            "https://codeberg.org/g/r/releases/download/3.3.0/Gram-x86_64-3.3.0.dmg"
        );
        assert_eq!(
            release.assets[0].sha256.as_deref(),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );
    }

    #[test]
    fn ignores_malformed_sha256_checksums() {
        assert_eq!(
            sha256_field(&serde_json::json!({ "digest": "sha256:xyz" })),
            None
        );
        assert_eq!(
            sha256_field(&serde_json::json!({
                "sha256": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
            })),
            Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into())
        );
    }

    #[test]
    fn calculates_sha256() {
        let mut hasher = Sha256::new();
        hasher.update(b"abc");
        assert_eq!(
            format!("{:x}", hasher.finalize()),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn reads_gitlab_links() {
        let release = normalize_release(serde_json::json!({
            "tag_name": "v2.0.0",
            "assets": {
                "links": [
                    { "name": "app.zip", "url": "https://gitlab.com/g/p/-/jobs/artifacts/main/download", "direct_asset_url": "https://gitlab.com/g/p/-/releases/v2.0.0/downloads/app.zip" }
                ]
            }
        }));

        assert_eq!(release.tag_name.as_deref(), Some("v2.0.0"));
        assert_eq!(
            release.assets[0].browser_download_url,
            "https://gitlab.com/g/p/-/releases/v2.0.0/downloads/app.zip"
        );
    }

    #[test]
    fn reads_gitlab_link_without_direct_url() {
        let release = normalize_release(serde_json::json!({
            "assets": { "links": [{ "name": "app.zip", "url": "https://gitlab.com/fallback.zip" }] }
        }));

        assert_eq!(release.tag_name, None);
        assert_eq!(release.assets[0].browser_download_url, "https://gitlab.com/fallback.zip");
    }

    #[test]
    fn unwraps_a_release_list() {
        let release = normalize_release(serde_json::json!([
            { "tag_name": "1.0.0", "assets": [{ "name": "a.zip", "browser_download_url": "https://host/a.zip" }] }
        ]));

        assert_eq!(release.tag_name.as_deref(), Some("1.0.0"));
        assert_eq!(release.assets.len(), 1);
    }

    #[test]
    fn tolerates_missing_and_malformed_assets() {
        let release = normalize_release(serde_json::json!({
            "tag_name": "1.0.0",
            "assets": [{ "name": "no-url.zip" }, { "browser_download_url": "https://host/b.zip" }]
        }));

        assert_eq!(release.tag_name.as_deref(), Some("1.0.0"));
        assert!(release.assets.is_empty());
    }

    #[test]
    fn treats_empty_strings_as_absent() {
        let release = normalize_release(serde_json::json!({ "tag_name": "", "name": "" }));

        assert_eq!(release.tag_name, None);
        assert_eq!(release.name, None);
    }

    #[test]
    fn rejects_non_https_urls() {
        assert!(parse_https_url("http://codeberg.org/api", "rejected").is_err());
        assert!(parse_https_url("not a url", "rejected").is_err());
        assert!(parse_https_url("https://codeberg.org/api", "rejected").is_ok());
    }

    #[test]
    fn normalizes_app_names_for_matching() {
        assert_eq!(normalized_app_name("Signal-Desktop"), "signaldesktop");
        assert_eq!(normalized_app_name("  VS Code  "), "vscode");
    }

    #[test]
    fn returns_only_a_unique_identifier() {
        assert_eq!(unique_identifier(vec!["app.id".into(), "app.id".into()]), Some("app.id".into()));
        assert_eq!(unique_identifier(vec!["first".into(), "second".into()]), None);
    }
}
