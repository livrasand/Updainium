use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, Manager, Runtime, WindowEvent};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeepLinkAction {
    pub kind: DeepLinkKind,
    pub payload: Option<String>,
}

/// Actions waiting for the frontend. Events emitted before the UI registers its
/// listener (for example when a link launches the app from a closed state) would
/// otherwise be lost, so the frontend drains this queue on mount and on each event.
#[derive(Default)]
pub struct PendingDeepLinks(Mutex<Vec<DeepLinkAction>>);

#[derive(Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DeepLinkKind {
    Open,
    Add,
    App,
    Apps,
    Refresh,
}

pub const SCHEME: &str = "updainium";

const MAX_PAYLOAD_BYTES: usize = 2 * 1024 * 1024;

pub fn parse_deep_link(url: &str) -> Option<DeepLinkAction> {
    let parsed = url::Url::parse(url).ok()?;
    if parsed.scheme() != SCHEME {
        return None;
    }
    let host = parsed.host_str().unwrap_or("");
    let path = parsed.path();
    if host.is_empty() || path.is_empty() || path == "/" {
        return Some(DeepLinkAction {
            kind: DeepLinkKind::Open,
            payload: None,
        });
    }
    if path == "/add" {
        let payload = parsed.query_pairs().find(|(key, _)| key == "url").map(|(_, value)| value.into_owned());
        return Some(DeepLinkAction {
            kind: DeepLinkKind::Add,
            payload,
        });
    }
    if path == "/refresh" {
        let payload = parsed.query_pairs().find(|(key, _)| key == "id").map(|(_, value)| value.into_owned());
        return Some(DeepLinkAction {
            kind: DeepLinkKind::Refresh,
            payload,
        });
    }
    if path == "/app" {
        let payload = parsed.query_pairs().find(|(key, _)| key == "json").map(|(_, value)| value.into_owned());
        return Some(DeepLinkAction {
            kind: DeepLinkKind::App,
            payload,
        });
    }
    if path == "/apps" {
        let payload = parsed.query_pairs().find(|(key, _)| key == "json").map(|(_, value)| value.into_owned());
        return Some(DeepLinkAction {
            kind: DeepLinkKind::Apps,
            payload,
        });
    }
    if path.starts_with("/app/") {
        let payload = path.trim_start_matches("/app/").to_string();
        return Some(DeepLinkAction {
            kind: DeepLinkKind::App,
            payload: Some(payload),
        });
    }
    if path.starts_with("/apps/") {
        let payload = path.trim_start_matches("/apps/").to_string();
        return Some(DeepLinkAction {
            kind: DeepLinkKind::Apps,
            payload: Some(payload),
        });
    }
    if path.starts_with("/add/") {
        let payload = path.trim_start_matches("/add/").to_string();
        return Some(DeepLinkAction {
            kind: DeepLinkKind::Add,
            payload: Some(payload),
        });
    }
    None
}

pub fn validate_payload_size(payload: &str) -> Result<(), String> {
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err("The deep link payload is too large.".to_owned());
    }
    Ok(())
}

pub fn emit_deep_link<R: Runtime>(app: &tauri::AppHandle<R>, action: DeepLinkAction) {
    if let Some(pending) = app.try_state::<PendingDeepLinks>() {
        if let Ok(mut queue) = pending.0.lock() {
            queue.push(action.clone());
        }
    }
    let _ = app.emit("deep-link://action", action);
}

#[tauri::command]
pub fn take_pending_deep_links(pending: tauri::State<'_, PendingDeepLinks>) -> Vec<DeepLinkAction> {
    pending
        .0
        .lock()
        .map(|mut queue| std::mem::take(&mut *queue))
        .unwrap_or_default()
}

pub fn handle_urls<R: Runtime>(app: &tauri::AppHandle<R>, urls: &[String]) {
    for url in urls {
        let Some(action) = parse_deep_link(url) else {
            continue;
        };
        if let Some(payload) = action.payload.as_deref() {
            if let Err(error) = validate_payload_size(payload) {
                eprintln!("Ignoring deep link: {error}");
                continue;
            }
        }
        emit_deep_link(app, action);
    }
}

pub fn install<R: Runtime>(app: &mut tauri::App<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let app_handle = app.app_handle().clone();
        let _ = window.on_window_event(move |event| {
            if let WindowEvent::Focused(true) = event {
                let _ = app_handle.emit("deep-link://focus", ());
            }
        });
    }
}
