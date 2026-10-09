// `Command`/`Manager` are used only by the release branch below, which the
// compiler strips from debug builds — silence the resulting unused warnings.
#![allow(unused_imports)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command};
use std::time::Duration;

use tauri::{AppHandle, Manager};

/// Release: the bundled Next.js standalone server listens here; the shell's
/// main window is pointed at this URL in `tauri.conf.json`.
pub const RELEASE_PORT: u16 = 3210;
/// Dev: `next dev` already serves the app; `build.devUrl` points here.
pub const DEV_PORT: u16 = 3000;

pub fn server_port() -> u16 {
    if cfg!(debug_assertions) {
        DEV_PORT
    } else {
        RELEASE_PORT
    }
}

/// Spawn the bundled Next.js standalone server (release builds only).
///
/// The runtime bundle (`node.exe` + the standalone `server.js` tree) is shipped
/// as a Tauri resource named `runtime`. Dev builds skip this entirely: they rely
/// on `pnpm dev` already running, which `build.devUrl` points the webview at.
pub fn start(app: &AppHandle) -> Option<Child> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        None
    }

    #[cfg(not(debug_assertions))]
    {
        let runtime_dir = app
            .path()
            .resolve("runtime", tauri::path::BaseDirectory::Resource)
            .ok()?;
        let node_exe = runtime_dir.join("node.exe");
        if !node_exe.exists() {
            eprintln!(
                "[next-server] missing {} — run `pnpm desktop:runtime` before building the app",
                node_exe.display()
            );
            return None;
        }
        let child = Command::new(&node_exe)
            .arg("server.js")
            .current_dir(&runtime_dir)
            .env("NODE_ENV", "production")
            .env("HOSTNAME", "127.0.0.1")
            .env("PORT", RELEASE_PORT.to_string())
            .spawn()
            .ok()?;
        eprintln!(
            "[next-server] spawned {} server.js on 127.0.0.1:{}",
            node_exe.display(),
            RELEASE_PORT
        );
        Some(child)
    }
}

/// Poll `GET /api/health` until the server answers HTTP 200, or give up after
/// `timeout`. Used to keep the main window hidden until the app is reachable.
pub fn wait_ready(port: u16, timeout: Duration) -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .expect("literal loopback address");
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if let Ok(mut stream) =
            TcpStream::connect_timeout(&addr, Duration::from_millis(800))
        {
            let _ = stream.write_all(
                b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
            );
            let mut buf = [0u8; 256];
            if let Ok(n) = stream.read(&mut buf) {
                let head = String::from_utf8_lossy(&buf[..n]);
                if head.contains("200") {
                    return true;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}
