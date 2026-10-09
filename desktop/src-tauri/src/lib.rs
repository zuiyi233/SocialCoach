mod next_server;
mod plugins;

use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Manager;

/// Owns the spawned Next.js server process. Shared between the setup thread
/// (which spawns it) and the run callback (which kills it on exit).
struct ServerProcess(Arc<Mutex<Option<Child>>>);

#[tauri::command]
fn update_tray_menu(
    app: tauri::AppHandle,
    show_text: String,
    quit_text: String,
) -> Result<(), String> {
    plugins::system_tray::update_tray_menu(&app, &show_text, &quit_text)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));

    let builder = tauri::Builder::default()
        .manage(ServerProcess(server_child.clone()))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When attempting to start a second instance, focus the existing main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
                let _ = window.show();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(plugins::system_tray::init())
        // The main window starts hidden; once the local server is reachable we
        // show it. In release the server is spawned here; in dev it is assumed
        // to be `next dev` already running on the devUrl port.
        .setup(move |app| {
            let handle = app.handle().clone();
            let holder = server_child.clone();
            std::thread::spawn(move || {
                let child = next_server::start(&handle);
                *holder.lock().unwrap() = child;
                let port = next_server::server_port();
                let ready = next_server::wait_ready(port, Duration::from_secs(30));
                eprintln!(
                    "[next-server] http://127.0.0.1:{port} ready={ready} — showing window"
                );
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![update_tray_menu]);

    // Auto-update is deferred (placeholder keys were causing config parse
    // failures in local builds). Re-enable by restoring the `plugins.updater`
    // block in tauri.conf.json and registering the plugin here.
    #[cfg(all(not(debug_assertions), feature = "updater"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let holder = app_handle.state::<ServerProcess>();
                let mut guard = holder.0.lock().unwrap();
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                    eprintln!("[next-server] server process stopped");
                }
            }
        });
}