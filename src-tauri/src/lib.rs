use tauri::{AppHandle, Manager, Emitter};
use std::path::PathBuf;
use tokio::fs::{File, create_dir_all};
use tokio::io::{AsyncWriteExt, AsyncBufReadExt, BufReader};
use std::process::Stdio;
use tokio::process::Command;
use futures_util::StreamExt;

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    engine: String,
    progress: f64,
}

#[tauri::command]
async fn check_and_download_engines(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    
    if !data_dir.exists() {
        create_dir_all(&data_dir).await.map_err(|e| e.to_string())?;
    }

    let (yt_url, yt_name, ffmpeg_url, ffmpeg_name) = get_engine_urls();
    
    let yt_path = data_dir.join(&yt_name);
    if !yt_path.exists() {
        download_file(&app, &yt_url, &yt_path, "yt-dlp".to_string()).await?;
    }

    let ffmpeg_path = data_dir.join(&ffmpeg_name);
    if !ffmpeg_path.exists() {
        download_file(&app, &ffmpeg_url, &ffmpeg_path, "ffmpeg".to_string()).await?;
    }
    
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(&yt_path) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&yt_path, perms);
        }
        if let Ok(metadata) = std::fs::metadata(&ffmpeg_path) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&ffmpeg_path, perms);
        }
    }

    Ok(())
}

fn get_engine_urls() -> (String, String, String, String) {
    #[cfg(target_os = "windows")]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe".into(),
            "yt-dlp.exe".into(),
            "https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/ffmpeg-win32-x64.exe".into(),
            "ffmpeg.exe".into()
        )
    }
    #[cfg(target_os = "macos")]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos".into(),
            "yt-dlp".into(),
            "https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/ffmpeg-darwin-x64".into(),
            "ffmpeg".into()
        )
    }
    #[cfg(target_os = "linux")]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux".into(),
            "yt-dlp".into(),
            "https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/ffmpeg-linux-x64".into(),
            "ffmpeg".into()
        )
    }
}

async fn download_file(app: &AppHandle, url: &str, path: &PathBuf, engine: String) -> Result<(), String> {
    let res = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let total_size = res.content_length().unwrap_or(0) as f64;
    
    let mut file = File::create(path).await.map_err(|e| e.to_string())?;
    let mut stream = res.bytes_stream();
    
    let mut downloaded = 0f64;
    
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as f64;
        
        if total_size > 0.0 {
            let progress = (downloaded / total_size) * 100.0;
            let _ = app.emit("engine-download-progress", DownloadProgress {
                engine: engine.clone(),
                progress,
            });
        }
    }
    
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
async fn start_download(
    app: AppHandle,
    url: String,
    format: String,
    quality: String,
    dest_folder: String,
    playlist: bool,
    browser: String,
) -> Result<(), String> {
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let (_, yt_name, _, ffmpeg_name) = get_engine_urls();
    
    let yt_path = data_dir.join(&yt_name);
    let ffmpeg_path = data_dir.join(&ffmpeg_name);

    if !yt_path.exists() {
        return Err("yt-dlp no está instalado. Reinicia la aplicación.".to_string());
    }

    let mut cmd = Command::new(&yt_path);
    cmd.stdout(Stdio::piped())
       .stderr(Stdio::piped());

    // Basic args
    cmd.arg("-N").arg("4")
       .arg("--retries").arg("infinite")
       .arg("--fragment-retries").arg("infinite")
       .arg("--ignore-errors")
       .arg("--newline");

    if ffmpeg_path.exists() {
        cmd.arg("--ffmpeg-location").arg(&ffmpeg_path);
    }

    if browser != "none" {
        cmd.arg("--cookies-from-browser").arg(&browser);
    }

    if !playlist {
        cmd.arg("--no-playlist");
    } else {
        cmd.arg("--yes-playlist");
    }

    // Format handling
    if format == "audio" {
        cmd.arg("-x").arg("--audio-format").arg("mp3").arg("--audio-quality").arg("0");
    } else {
        match quality.as_str() {
            "2160p" => cmd.arg("-f").arg("bestvideo[height<=2160]+bestaudio/best"),
            "1080p" => cmd.arg("-f").arg("bestvideo[height<=1080]+bestaudio/best"),
            "720p" => cmd.arg("-f").arg("bestvideo[height<=720]+bestaudio/best"),
            _ => cmd.arg("-f").arg("bestvideo+bestaudio/best"),
        };
    }

    cmd.arg("-o").arg(format!("{}/%(title)s.%(ext)s", dest_folder));
    cmd.arg(&url);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    
    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let mut reader = BufReader::new(stdout).lines();

    while let Ok(Some(line)) = reader.next_line().await {
        // Simple parser for yt-dlp newline output
        // Example: [download]  45.2% of 120.5MiB at 5.2MiB/s ETA 00:14
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
            start_download,
            get_history,
            save_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
