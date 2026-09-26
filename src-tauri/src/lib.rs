use tauri::{AppHandle, Manager, Emitter};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use futures_util::StreamExt;

#[tauri::command]
async fn check_and_download_engines(_app: AppHandle) -> Result<(), String> {
    // Los motores ya están empaquetados localmente con Tauri Sidecars.
    Ok(())
}

#[derive(Clone, serde::Serialize)]
struct VideoProgress {
    percent: f64,
    size: String,
    speed: String,
    eta: String,
    status: String,
}

#[tauri::command]
async fn get_video_info(app: AppHandle, url: String) -> Result<serde_json::Value, String> {
    let mut cmd = app.shell().sidecar("yt-dlp").map_err(|e| e.to_string())?;
    
    // Obtener información en JSON
    let output = cmd.arg("-j")
       .arg("--no-playlist")
       .arg(&url)
       .output()
       .await
       .map_err(|e| e.to_string())?;

    if output.status.success() {
        let json_str = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
        Ok(parsed)
    } else {
        let err_str = String::from_utf8_lossy(&output.stderr);
        Err(format!("Error obteniendo información: {}", err_str))
    }
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    url: String,
    format: String,
    quality: String,
    dest_folder: String,
    playlist: bool,
    browser: String,
) -> Result<(), String> {
    
    let mut cmd = app.shell().sidecar("yt-dlp").map_err(|e| e.to_string())?;

    cmd = cmd.arg("-N").arg("4")
       .arg("--retries").arg("infinite")
       .arg("--fragment-retries").arg("infinite")
       .arg("--ignore-errors")
       .arg("--newline");

    if browser != "none" {
        cmd = cmd.arg("--cookies-from-browser").arg(&browser);
    }

    if !playlist {
        cmd = cmd.arg("--no-playlist");
    } else {
        cmd = cmd.arg("--yes-playlist");
    }

    // Format handling
    if format == "audio" {
        cmd = cmd.arg("-x").arg("--audio-format").arg("mp3").arg("--audio-quality").arg("0");
    } else {
        match quality.as_str() {
            "2160p" => { cmd = cmd.arg("-f").arg("bestvideo[height<=2160]+bestaudio/best"); },
            "1080p" => { cmd = cmd.arg("-f").arg("bestvideo[height<=1080]+bestaudio/best"); },
            "720p" => { cmd = cmd.arg("-f").arg("bestvideo[height<=720]+bestaudio/best"); },
            _ => { cmd = cmd.arg("-f").arg("bestvideo+bestaudio/best"); },
        };
    }

    cmd = cmd.arg("-o").arg(format!("{}/%(title)s.%(ext)s", dest_folder));
    cmd = cmd.arg(&url);

    let (mut rx, mut child) = cmd.spawn().map_err(|e| e.to_string())?;

    while let Some(event) = rx.next().await {
        if let CommandEvent::Stdout(line_bytes) = event {
            let line = String::from_utf8_lossy(&line_bytes);
            
            if line.starts_with("[download]") && line.contains("%") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                let mut percent = 0.0;
                let mut size = String::new();
                let mut speed = String::new();
                let mut eta = String::new();

                for (i, p) in parts.iter().enumerate() {
                    if p.contains("%") {
                        percent = p.replace("%", "").parse().unwrap_or(0.0);
                    } else if p.contains("MiB") || p.contains("GiB") || p.contains("KiB") {
                        if size.is_empty() {
                            size = p.to_string();
                        } else if p.contains("/s") {
                            speed = p.to_string();
                        }
                    } else if *p == "ETA" && i + 1 < parts.len() {
                        eta = parts[i + 1].to_string();
                    }
                }

                let _ = app.emit("download-progress", VideoProgress {
                    percent,
                    size,
                    speed,
                    eta,
                    status: "Descargando...".to_string(),
                });
            }
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if status.success() {
        let _ = app.emit("download-progress", VideoProgress {
            percent: 100.0,
            size: "Completado".to_string(),
            speed: "-".to_string(),
            eta: "00:00".to_string(),
            status: "Completado".to_string(),
        });
        Ok(())
    } else {
        Err("Error en la descarga".to_string())
    }
}

#[tauri::command]
async fn get_history(app: AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let history_file = data_dir.join("history.json");
    if history_file.exists() {
        tokio::fs::read_to_string(history_file).await.map_err(|e| e.to_string())
    } else {
        Ok("[]".to_string())
    }
}

#[tauri::command]
async fn save_history(app: AppHandle, history_json: String) -> Result<(), String> {
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    if !data_dir.exists() {
        tokio::fs::create_dir_all(&data_dir).await.map_err(|e| e.to_string())?;
    }
    let history_file = data_dir.join("history.json");
    tokio::fs::write(history_file, history_json).await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_and_download_engines,
            get_video_info,
            start_download,
            get_history,
            save_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
