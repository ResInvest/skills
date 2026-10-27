//! ResInvest ERP — aplikacja Windows (Tauri 2).
//!
//! Okno natywne na serwer firmowy: interfejs, logowanie i dane pochodzą z serwera (ten sam frontend co w przeglądarce
//! i PWA). Aplikacja przechowuje lokalnie wyłącznie adres serwera. Bezpieczeństwo:
//!  - strona serwera NIE ma dostępu do funkcji systemowych (uprawnienia IPC tylko dla lokalnego ekranu konfiguracji),
//!  - okno otwiera tylko adresy serwera ERP; inne linki — w przeglądarce systemowej,
//!  - wymagane https (http wyłącznie dla komputera lokalnego),
//!  - jedno okno aplikacji (drugie uruchomienie przywraca istniejące).

mod server;

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use url::Url;

const MAIN: &str = "main";

#[derive(Default, Serialize, Deserialize)]
struct Config {
    server: Option<String>,
}

/// Bieżący adres serwera (do kontroli nawigacji).
struct ServerState(Mutex<Option<Url>>);

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("Nie można utworzyć katalogu ustawień: {e}"))?;
    Ok(dir.join("server.json"))
}

fn load_config(app: &AppHandle) -> Config {
    config_path(app).ok().and_then(|p| fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_config(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_path(app)?, json).map_err(|e| format!("Nie można zapisać ustawień: {e}"))
}

/// Ekran konfiguracji: zapis adresu serwera i przejście okna na serwer.
#[tauri::command]
fn save_server(app: AppHandle, url: String) -> Result<String, String> {
    let origin = server::normalize(&url)?;
    save_config(&app, &Config { server: Some(origin.to_string()) })?;
    *app.state::<ServerState>().0.lock().map_err(|e| e.to_string())? = Some(origin.clone());
    if let Some(w) = app.get_webview_window(MAIN) {
        w.navigate(origin.clone()).map_err(|e| e.to_string())?;
    }
    Ok(origin.to_string())
}

/// Ekran konfiguracji: adres zapisany wcześniej (do podpowiedzi w polu).
#[tauri::command]
fn current_server(app: AppHandle) -> Option<String> {
    load_config(&app).server
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let file = Submenu::with_items(app, "Plik", true, &[
        &MenuItem::with_id(app, "reload", "Odśwież", true, Some("F5"))?,
        &MenuItem::with_id(app, "change-server", "Zmień adres serwera…", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "quit", "Zamknij", true, Some("Alt+F4"))?,
    ])?;
    let edit = Submenu::with_items(app, "Edycja", true, &[
        &PredefinedMenuItem::undo(app, Some("Cofnij"))?,
        &PredefinedMenuItem::redo(app, Some("Ponów"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, Some("Wytnij"))?,
        &PredefinedMenuItem::copy(app, Some("Kopiuj"))?,
        &PredefinedMenuItem::paste(app, Some("Wklej"))?,
        &PredefinedMenuItem::select_all(app, Some("Zaznacz wszystko"))?,
    ])?;
    let view = Submenu::with_items(app, "Widok", true, &[
        &PredefinedMenuItem::fullscreen(app, Some("Pełny ekran"))?,
    ])?;
    Menu::with_items(app, &[&file, &edit, &view])
}

pub fn run() {
    tauri::Builder::default()
        // drugie uruchomienie — pokaż istniejące okno zamiast otwierać nowe
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window(MAIN) {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(ServerState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![save_server, current_server])
        .setup(|app| {
            let handle = app.handle().clone();
            // adres: parametr uruchomienia (--server) > zmienna RESINVEST_SERVER_URL > zapisany w ustawieniach
            let preset = server::from_args(std::env::args()).or_else(|| std::env::var("RESINVEST_SERVER_URL").ok());
            let mut cfg = load_config(&handle);
            if let Some(p) = preset {
                if let Ok(origin) = server::normalize(&p) {
                    cfg.server = Some(origin.to_string());
                    let _ = save_config(&handle, &cfg);
                }
            }
            let origin = cfg.server.as_deref().and_then(|s| server::normalize(s).ok());
            *app.state::<ServerState>().0.lock().expect("stan serwera") = origin.clone();

            let start = match &origin {
                Some(u) => WebviewUrl::External(u.clone()),
                None => WebviewUrl::App("index.html".into()),
            };
            let nav = handle.clone();
            WebviewWindowBuilder::new(app, MAIN, start)
                .title("ResInvest ERP")
                .inner_size(1360.0, 860.0)
                .min_inner_size(960.0, 600.0)
                .menu(build_menu(&handle)?)
                .on_navigation(move |target| {
                    // lokalny ekran konfiguracji (tauri://, http(s)://tauri.localhost) — zawsze dozwolony
                    if target.scheme() == "tauri" || target.host_str() == Some("tauri.localhost") || target.scheme() == "about" {
                        return true;
                    }
                    let server = nav.state::<ServerState>().0.lock().ok().and_then(|g| g.clone());
                    if server.as_ref().is_some_and(|s| server::same_origin(s, target)) {
                        return true;
                    }
                    // poza serwerem ERP — przeglądarka systemowa (tylko http/https/mailto)
                    if matches!(target.scheme(), "http" | "https" | "mailto") {
                        let _ = nav.opener().open_url(target.as_str(), None::<&str>);
                    }
                    false
                })
                .build()?;

            app.on_menu_event(|app, event| match event.id().as_ref() {
                "reload" => {
                    if let Some(w) = app.get_webview_window(MAIN) {
                        let _ = w.eval("window.location.reload()");
                    }
                }
                "change-server" => {
                    let _ = save_config(app, &Config::default());
                    app.restart();
                }
                "quit" => app.exit(0),
                _ => {}
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Nie udało się uruchomić aplikacji ResInvest ERP");
}
