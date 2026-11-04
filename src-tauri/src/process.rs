use serde::Serialize;
use std::path::Path;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningAppState {
    pub running: bool,
    pub launch_path: Option<String>,
    pub is_self: bool,
}

const QUIT_TIMEOUT: Duration = Duration::from_secs(15);
const QUIT_POLL_INTERVAL: Duration = Duration::from_millis(500);

pub fn validate_process_name(app_name: &str) -> Result<String, String> {
    let name = app_name.trim();
    if name.is_empty()
        || !name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || " .-_".contains(character))
    {
        return Err("The app name contains unsupported characters.".into());
    }
    Ok(name.to_owned())
}

pub fn validate_launch_path(launch_path: &str) -> Result<String, String> {
    let path = launch_path.trim();
    if path.is_empty() || path.chars().any(|character| character.is_control()) {
        return Err("The remembered app launch path is invalid.".into());
    }
    Ok(path.to_owned())
}

fn is_self_identity(
    own_identifier: &str,
    own_name: &str,
    requested_name: &str,
    requested_identifier: Option<&str>,
) -> bool {
    if let Some(identifier) = requested_identifier {
        if identifier.eq_ignore_ascii_case(own_identifier) {
            return true;
        }
    }
    let own = own_name.trim();
    !own.is_empty() && requested_name.trim().eq_ignore_ascii_case(own)
}

struct TimeBudget {
    deadline: Instant,
}

impl TimeBudget {
    fn start() -> Self {
        Self::after(QUIT_TIMEOUT)
    }

    fn after(duration: Duration) -> Self {
        Self {
            deadline: Instant::now() + duration,
        }
    }

    fn expired(&self) -> bool {
        Instant::now() >= self.deadline
    }
}

fn next_poll_sleep(budget: &TimeBudget) -> Duration {
    let remaining = budget.deadline.saturating_duration_since(Instant::now());
    std::cmp::min(QUIT_POLL_INTERVAL, remaining)
}

// ---------------------------------------------------------------------------
// Commands.

#[tauri::command]
pub async fn get_running_app_state(
    app: tauri::AppHandle,
    app_name: String,
    app_identifier: Option<String>,
) -> Result<RunningAppState, String> {
    let own_identifier = app.config().identifier.clone();
    let own_name = app.package_info().name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let name = validate_process_name(&app_name)?;
        if let Some(identifier) = app_identifier.as_deref() {
            crate::validate_identifier(identifier)?;
        }
        if is_self_identity(
            &own_identifier,
            &own_name,
            &name,
            app_identifier.as_deref().map(str::trim),
        ) {
            // Updainium itself is running by definition; its close and relaunch
            // stay in the user's hands instead of automated quitting.
            return Ok(RunningAppState {
                running: true,
                launch_path: None,
                is_self: true,
            });
        }
        running_state(&name, app_identifier.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn quit_running_app(
    app: tauri::AppHandle,
    app_name: String,
    app_identifier: Option<String>,
) -> Result<bool, String> {
    let own_identifier = app.config().identifier.clone();
    let own_name = app.package_info().name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let name = validate_process_name(&app_name)?;
        if let Some(identifier) = app_identifier.as_deref() {
            crate::validate_identifier(identifier)?;
        }
        if is_self_identity(
            &own_identifier,
            &own_name,
            &name,
            app_identifier.as_deref().map(str::trim),
        ) {
            return Err("Updainium will not quit itself; close it manually instead.".into());
        }
        quit_app(&name, app_identifier.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn open_installed_app(
    app: tauri::AppHandle,
    app_name: String,
    app_identifier: Option<String>,
    launch_path: Option<String>,
) -> Result<bool, String> {
    let own_identifier = app.config().identifier.clone();
    let own_name = app.package_info().name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let name = validate_process_name(&app_name)?;
        if let Some(identifier) = app_identifier.as_deref() {
            crate::validate_identifier(identifier)?;
        }
        if let Some(path) = launch_path.as_deref() {
            validate_launch_path(path)?;
        }
        if is_self_identity(
            &own_identifier,
            &own_name,
            &name,
            app_identifier.as_deref().map(str::trim),
        ) {
            return Err("Updainium is already running, so it will not relaunch itself.".into());
        }
        // A second running check prevents launching the same app twice if the
        // user (or its installer) already reopened it.
        let state = running_state(&name, app_identifier.as_deref())?;
        if state.running {
            return Ok(false);
        }
        reopen_app(&name, app_identifier.as_deref(), launch_path.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn running_state(app_name: &str, app_identifier: Option<&str>) -> Result<RunningAppState, String> {
    #[cfg(target_os = "macos")]
    {
        return running_macos(app_name, app_identifier);
    }
    #[cfg(target_os = "windows")]
    {
        return running_windows(app_name);
    }
    #[cfg(target_os = "linux")]
    {
        return running_linux(app_name);
    }
    #[allow(unreachable_code)]
    Err("App state detection is not supported on this operating system.".into())
}

fn quit_app(app_name: &str, app_identifier: Option<&str>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        return quit_macos(app_name, app_identifier);
    }
    #[cfg(target_os = "windows")]
    {
        return quit_windows(app_name);
    }
    #[cfg(target_os = "linux")]
    {
        return quit_linux(app_name);
    }
    #[allow(unreachable_code)]
    Err("Graceful app closing is not supported on this operating system.".into())
}

#[allow(unused_variables)] // `app_name` is only consumed by the Linux branch
fn reopen_app(
    app_name: &str,
    app_identifier: Option<&str>,
    launch_path: Option<&str>,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        return open_macos(app_identifier, launch_path);
    }
    #[cfg(target_os = "windows")]
    {
        return open_windows(app_identifier, launch_path);
    }
    #[cfg(target_os = "linux")]
    {
        return open_linux(app_name, launch_path);
    }
    #[allow(unreachable_code)]
    Err("Relaunching apps is not supported on this operating system.".into())
}

pub type PsProcess = (u32, String);

fn parse_ps_rows(output: &str) -> Vec<PsProcess> {
    output
        .lines()
        .filter_map(|line| {
            let (pid, command) = line.trim().split_once(' ')?;
            let pid = pid.parse::<u32>().ok()?;
            (pid > 0).then_some((pid, command.trim().to_owned()))
        })
        .collect()
}

fn bundle_matches_command(command: &str, bundle_path: &str) -> bool {
    command
        .to_lowercase()
        .contains(&format!("{}/Contents/", bundle_path.trim_end_matches('/')).to_lowercase())
}

fn bundle_from_command(command: &str) -> Option<String> {
    let haystack = command.to_lowercase();
    let index = haystack.find(".app/contents")? + ".app".len();
    let start = haystack[..index].find('/')?;
    Some(command[start..index].to_owned())
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn powershell_single_quoted(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn windows_rows_from_output(output: &str) -> Vec<PsProcess> {
    output
        .lines()
        .filter_map(|line| {
            let (pid, path) = line.split_once('|')?;
            let pid = pid.trim().parse::<u32>().ok()?;
            Some((pid, path.trim().to_owned()))
        })
        .collect()
}

#[cfg_attr(not(test), allow(dead_code))]
fn windows_exe_basename(path: &str) -> String {
    path.rsplit(['\\', '/'])
        .find(|segment| !segment.is_empty())
        .unwrap_or("")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_process_name_accepts_display_names() {
        assert_eq!(
            validate_process_name("  Mozilla Firefox ").unwrap(),
            "Mozilla Firefox"
        );
        assert_eq!(validate_process_name("Foo-B_2.7").unwrap(), "Foo-B_2.7");
        assert!(validate_process_name("").is_err());
        assert!(validate_process_name("a'b\"c").is_err());
        assert!(validate_process_name("é").is_err());
        assert!(validate_process_name("foo;bar").is_err());
    }

    #[test]
    fn validate_launch_path_rejects_control_characters() {
        assert_eq!(
            validate_launch_path("/Applications/Foo.app").unwrap(),
            "/Applications/Foo.app"
        );
        assert!(validate_launch_path("bad\tid").is_err());
        assert!(validate_launch_path("").is_err());
        assert!(validate_launch_path("a\0b").is_err());
    }

    #[test]
    fn self_identity_matches_identifier_or_name() {
        assert!(is_self_identity(
            "com.livrasand.updainium",
            "updainium",
            "Updainium",
            Some("com.livrasand.updainium")
        ));
        assert!(is_self_identity(
            "com.other",
            "updainium",
            " Updainium ",
            None
        ));
        assert!(!is_self_identity(
            "com.livrasand.updainium",
            "updainium",
            "Firefox",
            Some("org.mozilla.firefox")
        ));
        assert!(!is_self_identity("com.other", "", "updainium", None));
    }

    #[test]
    fn parse_ps_rows_reads_pid_and_command() {
        let rows =
            parse_ps_rows("  123 /Applications/Foo.app/Contents/MacOS/Foo\n1   /usr/bin/x -y\n");
        assert_eq!(
            rows,
            vec![
                (
                    123_u32,
                    "/Applications/Foo.app/Contents/MacOS/Foo".to_owned()
                ),
                (1_u32, "/usr/bin/x -y".to_owned()),
            ]
        );
        assert!(parse_ps_rows("").is_empty());
        assert!(parse_ps_rows("not-a-pid /x").is_empty());
        assert!(parse_ps_rows("0 /dev/null").is_empty());
    }

    #[test]
    fn bundle_matching_is_case_insensitive() {
        assert!(bundle_matches_command(
            "/applications/FOO.app/Contents/MacOS/FOO --flag",
            "/Applications/Foo.app",
        ));
        assert!(!bundle_matches_command(
            "/usr/bin/other",
            "/Applications/Foo.app"
        ));
    }

    #[test]
    fn bundle_from_command_finds_bundle_roots() {
        assert_eq!(
            bundle_from_command("/Applications/Foo.app/Contents/MacOS/Foo --foo"),
            Some("/Applications/Foo.app".to_owned())
        );
        assert_eq!(
            bundle_from_command(
                "/Applications/Foo.app/Contents/Frameworks/Foo Helper.app/Contents/MacOS/Foo Helper"
            ),
            Some("/Applications/Foo.app".to_owned())
        );
        assert_eq!(bundle_from_command("/usr/bin/plain"), None);
    }

    #[test]
    fn powershell_quoting_doubles_inner_quotes() {
        assert_eq!(powershell_single_quoted("Foo"), "'Foo'");
        assert_eq!(powershell_single_quoted("O'B"), "'O''B'");
    }

    #[test]
    fn windows_rows_parse_pid_and_path() {
        let rows = windows_rows_from_output("123|C:\\Apps\\Foo.exe\n456|\n");
        assert_eq!(
            rows,
            vec![
                (123_u32, "C:\\Apps\\Foo.exe".to_owned()),
                (456_u32, String::new()),
            ]
        );
        assert!(windows_rows_from_output("").is_empty());
    }

    #[test]
    fn windows_basename_handles_drive_and_slashes() {
        assert_eq!(windows_exe_basename("C:\\Apps\\Foo.exe"), "foo.exe");
        assert_eq!(windows_exe_basename("/Apps/Foo.exe"), "foo.exe");
        assert_eq!(windows_exe_basename(""), "");
    }

    #[test]
    fn time_budget_expires_after_zero() {
        assert!(TimeBudget::after(Duration::ZERO).expired());
        assert!(!TimeBudget::after(Duration::from_secs(60)).expired());
        let short_sleep = next_poll_sleep(&TimeBudget::after(Duration::from_millis(10)));
        assert!(short_sleep > Duration::ZERO && short_sleep <= Duration::from_millis(10));
        assert_eq!(
            next_poll_sleep(&TimeBudget::after(Duration::from_secs(60))),
            QUIT_POLL_INTERVAL
        );
    }
}

// ---------------------------------------------------------------------------
// macOS implementation.

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    struct MacosState {
        running: bool,
        launch_path: Option<String>,
        pids: Vec<u32>,
    }

    fn bundle_candidates(app_name: &str, app_identifier: Option<&str>) -> Vec<String> {
        let mut bundles = Vec::new();
        let mut roots = vec![PathBuf::from("/Applications")];
        if let Some(home) = std::env::var_os("HOME") {
            roots.push(PathBuf::from(home).join("Applications"));
        }
        for root in roots {
            if let Ok(entries) = std::fs::read_dir(&root) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|ext| ext.to_str()) != Some("app")
                        || !path.is_dir()
                    {
                        continue;
                    }
                    if path
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .is_some_and(|stem| stem.eq_ignore_ascii_case(app_name))
                    {
                        bundles.push(path.to_string_lossy().into_owned());
                    }
                }
            }
        }
        if let Some(identifier) = app_identifier {
            bundles.extend(bundle_candidates_from_identifier(identifier));
        }
        bundles
    }

    fn bundle_candidates_from_identifier(identifier: &str) -> Vec<String> {
        let Ok(output) = Command::new("mdfind")
            .arg(format!("kMDItemCFBundleIdentifier == '{identifier}'"))
            .output()
        else {
            return Vec::new();
        };
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|path| path.ends_with(".app") && Path::new(path).is_dir())
            .map(str::to_owned)
            .collect()
    }

    fn detect(app_name: &str, app_identifier: Option<&str>) -> Result<MacosState, String> {
        let bundles = bundle_candidates(app_name, app_identifier);
        let mut running = false;
        let mut launch_path = None;
        let mut pids = Vec::new();
        let Ok(rows) = Command::new("ps")
            .args(["axww", "-o", "pid=,command="])
            .output()
            .map(|output| parse_ps_rows(&String::from_utf8_lossy(&output.stdout)))
        else {
            return Err("Could not list running processes with ps.".into());
        };
        for (pid, command) in rows {
            let mut matched = bundles
                .iter()
                .find(|bundle| bundle_matches_command(&command, bundle))
                .cloned();
            if matched.is_none() {
                // Without a resolvable bundle fall back to `/<name>.app/`
                // inside the command line, but require the bundle's basename
                // to match the app name so random `.app` runs are ignored.
                matched = bundle_from_command(&command).filter(|bundle| {
                    bundle
                        .rsplit('/')
                        .next()
                        .and_then(|name| name.strip_suffix(".app"))
                        .is_some_and(|name| name.eq_ignore_ascii_case(app_name))
                });
            }
            if let Some(bundle) = matched {
                running = true;
                pids.push(pid);
                if launch_path.is_none() {
                    launch_path = Some(bundle);
                }
            }
        }
        Ok(MacosState {
            running,
            launch_path,
            pids,
        })
    }

    fn plist_value(plist: &str, key: &str) -> Option<String> {
        let output = Command::new("defaults")
            .args(["read", plist, key])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        (!value.is_empty()).then_some(value)
    }

    fn request_quit(app_identifier: Option<&str>, state: &MacosState) {
        // The Apple event reaches menu-bar and background-run apps too and is
        // the most graceful way out; SIGTERM is only a fallback.
        let mut bundle_identifier = state
            .launch_path
            .as_deref()
            .and_then(|bundle| {
                plist_value(
                    &format!("{bundle}/Contents/Info.plist"),
                    "CFBundleIdentifier",
                )
            })
            .or_else(|| app_identifier.map(str::to_owned));
        if let Some(identifier) = bundle_identifier.take() {
            if identifier.chars().all(|character| {
                character.is_ascii_alphanumeric() || " .-_{}+~:@".contains(character)
            }) {
                let quit = Command::new("osascript")
                    .arg("-e")
                    .arg(format!("tell application id \"{identifier}\" to quit"))
                    .output();
                if matches!(quit, Ok(output) if output.status.success()) {
                    return;
                }
            }
        }
        for pid in &state.pids {
            let _ = Command::new("kill")
                .arg("-TERM")
                .arg(pid.to_string())
                .status();
        }
    }

    pub(super) fn running(
        app_name: &str,
        app_identifier: Option<&str>,
    ) -> Result<RunningAppState, String> {
        let state = detect(app_name, app_identifier)?;
        Ok(RunningAppState {
            running: state.running,
            launch_path: state.launch_path,
            is_self: false,
        })
    }

    pub(super) fn quit(app_name: &str, app_identifier: Option<&str>) -> Result<bool, String> {
        let state = detect(app_name, app_identifier)?;
        if !state.running {
            return Ok(true);
        }
        request_quit(app_identifier, &state);
        let budget = TimeBudget::start();
        loop {
            if !detect(app_name, app_identifier)?.running {
                return Ok(true);
            }
            if budget.expired() {
                return Ok(false);
            }
            std::thread::sleep(next_poll_sleep(&budget));
        }
    }

    pub(super) fn open(
        app_identifier: Option<&str>,
        launch_path: Option<&str>,
    ) -> Result<bool, String> {
        let bundle = launch_path
            .filter(|path| Path::new(path).join("Contents").is_dir())
            .map(str::to_owned)
            .or_else(|| {
                app_identifier.and_then(|identifier| {
                    bundle_candidates_from_identifier(identifier)
                        .into_iter()
                        .next()
                })
            })
            .ok_or_else(|| {
                "The updated app bundle could not be found, so it was not relaunched.".to_owned()
            })?;
        let output = Command::new("open")
            .arg(&bundle)
            .output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            Ok(true)
        } else {
            Err(format!(
                "The relaunch exited with status {}.",
                output.status.code().unwrap_or(-1)
            ))
        }
    }
}

#[cfg(target_os = "macos")]
use platform::{open as open_macos, quit as quit_macos, running as running_macos};

// ---------------------------------------------------------------------------
// Windows implementation.

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    const REGISTRY_UNINSTALL_ROOTS: [&str; 3] = [
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn process_names(app_name: &str) -> Vec<String> {
        let mut names = vec![app_name.to_owned()];
        let alternate = if let Some(stem) = app_name.strip_suffix(".exe") {
            stem.to_owned()
        } else {
            format!("{app_name}.exe")
        };
        if !names.contains(&alternate) {
            names.push(alternate);
        }
        names
    }

    fn run_powershell(script: &str) -> Result<String, String> {
        let mut child = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", "-"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| error.to_string())?;
        {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| "PowerShell stdin is unavailable.".to_owned())?;
            stdin
                .write_all(script.as_bytes())
                .map_err(|error| error.to_string())?;
        }
        let output = child
            .wait_with_output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "PowerShell exited with status {}; {}",
                output.status.code().unwrap_or(-1),
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    fn running_rows(process_name: &str) -> Result<Vec<PsProcess>, String> {
        let names = process_names(process_name)
            .into_iter()
            .map(|name| powershell_single_quoted(&name))
            .collect::<Vec<_>>()
            .join(",");
        // Doubled braces escape the PowerShell `{}` blocks for `format!`.
        let script = format!(
            concat!(
                "$ErrorActionPreference = 'SilentlyContinue'\n",
                "Get-Process -Name @({NAMES}) | Sort-Object Id | ForEach-Object {{\n",
                "  \"$($_.Id)|$($_.Path)\"\n",
                "}}\n",
            ),
            NAMES = names
        );
        run_powershell(&script).map(|stdout| windows_rows_from_output(&stdout))
    }

    fn close_request(process_name: &str) -> Result<(), String> {
        let names = process_names(process_name)
            .into_iter()
            .map(|name| powershell_single_quoted(&name))
            .collect::<Vec<_>>()
            .join(",");
        let script = format!(
            concat!(
                "$ErrorActionPreference = 'SilentlyContinue'\n",
                "$procs = Get-Process -Name @({NAMES})\n",
                "if ($procs) {{\n",
                "  [void]($procs | ForEach-Object {{ $_.CloseMainWindow(); }})\n",
                "}}\n",
                "exit 0\n",
            ),
            NAMES = names
        );
        run_powershell(&script).map(|_| ())
    }

    pub(super) fn running(process_name: &str) -> Result<RunningAppState, String> {
        let rows = running_rows(process_name)?;
        let launch_path = rows
            .iter()
            .find_map(|(_, path)| (!path.is_empty()).then(|| path.clone()));
        Ok(RunningAppState {
            running: !rows.is_empty(),
            launch_path,
            is_self: false,
        })
    }

    pub(super) fn quit(process_name: &str) -> Result<bool, String> {
        if running_rows(process_name)?.is_empty() {
            return Ok(true);
        }
        close_request(process_name)?;
        let budget = TimeBudget::start();
        loop {
            if running_rows(process_name)?.is_empty() {
                return Ok(true);
            }
            if budget.expired() {
                return Ok(false);
            }
            std::thread::sleep(next_poll_sleep(&budget));
        }
    }

    fn registry_launch_path(app_identifier: Option<&str>) -> Option<String> {
        let identifier = app_identifier?;
        for root in REGISTRY_UNINSTALL_ROOTS {
            let output = Command::new("reg")
                .args([
                    "query",
                    &format!(r"{root}\{identifier}"),
                    "/v",
                    "DisplayIcon",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .ok()?;
            if !output.status.success() {
                continue;
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            let Some(line) = stdout.lines().find(|line| line.contains("DisplayIcon")) else {
                continue;
            };
            let Some(value) = line.splitn(2, "REG_SZ").nth(1) else {
                continue;
            };
            let value = value.trim();
            let candidate = match value.rsplit_once(',') {
                Some((path, parameter)) if !parameter.trim().is_empty() => path,
                _ => value,
            };
            if Path::new(candidate.trim()).is_file() {
                return Some(candidate.trim().to_owned());
            }
        }
        None
    }

    pub(super) fn open(
        app_identifier: Option<&str>,
        launch_path: Option<&str>,
    ) -> Result<bool, String> {
        let executable = launch_path
            .filter(|path| Path::new(path).is_file())
            .map(str::to_owned)
            .or_else(|| registry_launch_path(app_identifier))
            .ok_or_else(|| {
                "The updated app executable could not be found, so it was not relaunched."
                    .to_owned()
            })?;
        let status = Command::new("cmd")
            .args(["/C", "start", "", &executable])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|error| error.to_string())?;
        if status.success() {
            Ok(true)
        } else {
            Err(format!("The relaunch exited with status {status}."))
        }
    }
}

#[cfg(target_os = "windows")]
use platform::{open as open_windows, quit as quit_windows, running as running_windows};

// ---------------------------------------------------------------------------
// Linux implementation.

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    struct LinuxState {
        running: bool,
        launch_path: Option<String>,
        pids: Vec<u32>,
    }

    fn strip_deleted(basename: &str) -> String {
        basename
            .strip_suffix(" (deleted)")
            .unwrap_or(basename)
            .to_owned()
    }

    fn detect(process_name: &str) -> Result<LinuxState, String> {
        let wanted = process_name.trim().to_ascii_lowercase();
        let own_pid = std::process::id();
        let mut running = false;
        let mut launch_path = None;
        let mut pids = Vec::new();
        let entries = std::fs::read_dir("/proc")
            .map_err(|error| format!("Could not read /proc to find running apps: {error}"))?;
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let Ok(pid) = file_name.to_string_lossy().parse::<u32>() else {
                continue;
            };
            // Never consider Updainium itself or init.
            if pid == own_pid || pid <= 1 {
                continue;
            }
            let argv0 = std::fs::read_to_string(format!("/proc/{pid}/cmdline"))
                .ok()
                .and_then(|cmdline| cmdline.split('\0').next().map(|command| command.to_owned()));
            let exe = std::fs::read_link(format!("/proc/{pid}/exe")).ok();
            let mut candidates: Vec<String> = argv0
                .as_deref()
                .and_then(|command| command.rsplit('/').next().map(str::to_owned))
                .into_iter()
                .collect();
            if let Some(path) = exe.as_deref() {
                if let Some(basename) = path
                    .to_str()
                    .and_then(|path| path.rsplit('/').next().map(str::to_owned))
                {
                    candidates.push(basename);
                }
            }
            if candidates
                .into_iter()
                .any(|basename| strip_deleted(&basename).eq_ignore_ascii_case(&wanted))
            {
                running = true;
                pids.push(pid);
                if launch_path.is_none() {
                    launch_path = exe
                        .as_deref()
                        .and_then(|path| path.to_str())
                        .map(str::to_owned);
                }
            }
        }
        Ok(LinuxState {
            running,
            launch_path,
            pids,
        })
    }

    fn terminate(state: &LinuxState) {
        let pids = state
            .pids
            .iter()
            .map(|pid| pid.to_string())
            .collect::<Vec<_>>();
        if pids.is_empty() {
            return;
        }
        let _ = Command::new("kill").arg("-TERM").args(pids).status();
    }

    pub(super) fn running(process_name: &str) -> Result<RunningAppState, String> {
        let state = detect(process_name)?;
        Ok(RunningAppState {
            running: state.running,
            launch_path: state.launch_path,
            is_self: false,
        })
    }

    pub(super) fn quit(process_name: &str) -> Result<bool, String> {
        let state = detect(process_name)?;
        if !state.running {
            return Ok(true);
        }
        terminate(&state);
        let budget = TimeBudget::start();
        loop {
            if !detect(process_name)?.running {
                return Ok(true);
            }
            if budget.expired() {
                return Ok(false);
            }
            std::thread::sleep(next_poll_sleep(&budget));
        }
    }

    fn which_launch_path(process_name: &str) -> Option<String> {
        let output = Command::new("which").arg(process_name).output().ok()?;
        if !output.status.success() {
            return None;
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        (!path.is_empty()).then_some(path)
    }

    fn spawn_detached(path: &str) -> Result<bool, String> {
        let mut child = Command::new(path)
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| error.to_string())?;
        std::thread::spawn(move || {
            // Reap the child; the process group keeps the app alive beyond
            // Updainium's own lifetime anyway.
            let _ = child.wait();
        });
        Ok(true)
    }

    pub(super) fn open(process_name: &str, launch_path: Option<&str>) -> Result<bool, String> {
        let path = launch_path
            .filter(|path| Path::new(path).exists())
            .map(str::to_owned)
            .or_else(|| which_launch_path(process_name))
            .ok_or_else(|| {
                "The updated app could not be found, so it was not relaunched.".to_owned()
            })?;
        spawn_detached(&path)
    }
}

#[cfg(target_os = "linux")]
use platform::{open as open_linux, quit as quit_linux, running as running_linux};
