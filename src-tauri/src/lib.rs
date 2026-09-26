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

#[derive(Clone, serde::Serialize)]
struct VideoProgress {
    percent: f64,
    size: String,
    speed: String,
    eta: String,
    status: String,
}

#[tauri::command]
async fn check_and_download_engines(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    if !data_dir.exists() {
        create_dir_all(&data_dir).await.map_err(|e| e.to_string())?;
    }

    let yt_target = data_dir.join("yt-dlp.exe");
    let ffmpeg_target = data_dir.join("ffmpeg.exe");

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let yt_src = resource_dir.join("bin").join("yt-dlp.exe");
    let ffmpeg_src = resource_dir.join("bin").join("ffmpeg.exe");

    if !yt_target.exists() && yt_src.exists() {
        std::fs::copy(&yt_src, &yt_target).map_err(|e| format!("Error copiando yt-dlp: {}", e))?;
    }
    if !ffmpeg_target.exists() && ffmpeg_src.exists() {
        std::fs::copy(&ffmpeg_src, &ffmpeg_target).map_err(|e| format!("Error copiando ffmpeg: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn update_engines(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let yt_target = data_dir.join("yt-dlp.exe");

    let client = reqwest::Client::builder().user_agent("VideoPlus/1.0").build().map_err(|e| e.to_string())?;
    let res = client.get("https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe").send().await.map_err(|e| e.to_string())?;
    let total_size = res.content_length().unwrap_or(0) as f64;
    
    let mut file = File::create(&yt_target).await.map_err(|e| e.to_string())?;
    let mut stream = res.bytes_stream();
    let mut downloaded = 0f64;
    
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as f64;
        
        if total_size > 0.0 {
            let progress = (downloaded / total_size) * 100.0;
            let _ = app.emit("engine-download-progress", DownloadProgress {
                engine: "yt-dlp".to_string(),
                progress,
            });
        }
    }
    Ok(())
}

#[tauri::command]
async fn get_video_info(app: AppHandle, url: String, browser: String) -> Result<serde_json::Value, String> {
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let yt_path = data_dir.join("yt-dlp.exe");

    let mut cmd = Command::new(&yt_path);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    cmd.arg("-j").arg("--no-playlist");

    if browser != "none" {
        cmd.arg("--cookies-from-browser").arg(&browser);
        cmd.arg("--extractor-args").arg("youtube:player_client=web");
    } else {
        cmd.arg("--extractor-args").arg("youtube:player_client=android,web");
    }

    let output = cmd.arg(&url)
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
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let yt_path = data_dir.join("yt-dlp.exe");
    let ffmpeg_path = data_dir.join("ffmpeg.exe");

    if !yt_path.exists() {
        return Err("yt-dlp no está instalado.".to_string());
    }

    let mut cmd = Command::new(&yt_path);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

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
        cmd.arg("--extractor-args").arg("youtube:player_client=web");
    } else {
        cmd.arg("--extractor-args").arg("youtube:player_client=android,web");
    }

    if !playlist {
        cmd.arg("--no-playlist");
    } else {
        cmd.arg("--yes-playlist");
    }

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
    let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

    let err_task = tokio::spawn(async move {
        let mut err_reader = BufReader::new(stderr).lines();
        let mut last_err = String::new();
        while let Ok(Some(line)) = err_reader.next_line().await {
            if line.contains("ERROR:") {
                last_err = line;
            }
        }
        last_err
    });

    let mut reader = BufReader::new(stdout).lines();

    while let Ok(Some(line)) = reader.next_line().await {
        if line.starts_with("[download]") && line.contains("%") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            let mut percent = 0.0;
            let mut size = String::new();
            let mut speed = String::new();
            let mut eta = String::new();

            for (i, p) in parts.iter().enumerate() {
                let p_clean = p.replace("~", "");
                if p_clean.ends_with("%") {
                    percent = p_clean.replace("%", "").parse().unwrap_or(0.0);
                } else if p_clean.contains("/s") {
                    speed = p_clean;
                } else if p_clean.contains("B") && !p_clean.contains("ETA") {
                    if size.is_empty() {
                        size = p_clean;
                    }
                } else if p_clean == "ETA" && i + 1 < parts.len() {
                    eta = parts[i + 1].replace("~", "");
                }
            }

            let _ = app.emit("download-progress", VideoProgress {
                percent, size, speed, eta, status: "Descargando...".to_string(),
            });
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let last_error = err_task.await.unwrap_or_default();

    if status.success() {
        let _ = app.emit("download-progress", VideoProgress {
            percent: 100.0, size: "Completado".to_string(), speed: "-".to_string(), eta: "00:00".to_string(), status: "Completado".to_string(),
        });
        Ok(())
    } else {
        if !last_error.is_empty() {
            Err(last_error)
        } else {
            Err("Error en la descarga. Verifica la URL o tu conexión.".to_string())
        }
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_and_download_engines,
            update_engines,
            get_video_info,
            start_download,
            get_history,
            save_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
