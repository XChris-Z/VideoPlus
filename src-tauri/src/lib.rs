use tauri::{AppHandle, Manager, Emitter};
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
    downloaded: String,
    size: String,
    speed: String,
    eta: String,
    status: String,
}

#[tauri::command]
fn read_clipboard() -> Result<String, String> {
    // 1. Intentar con arboard (Win32 nativo) con reintentos en caso de bloqueo temporal
    for _ in 0..3 {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(text) = cb.get_text() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Ok(trimmed.to_string());
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }

    // 2. Respaldo PowerShell en Windows
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", "Get-Clipboard"])
            .creation_flags(0x08000000)
            .output() 
        {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !s.is_empty() {
                return Ok(s);
            }
        }
    }

    Err("Portapapeles vacío o no accesible".to_string())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(&path);
        cmd.creation_flags(0x08000000);
        let _ = cmd.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn get_engine_versions(app: AppHandle) -> Result<serde_json::Value, String> {
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let yt_path = data_dir.join("yt-dlp.exe");
    let ffmpeg_path = data_dir.join("ffmpeg.exe");

    let mut yt_version = "No instalado".to_string();
    if yt_path.exists() {
        let mut cmd = Command::new(&yt_path);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        if let Ok(output) = cmd.arg("--version").output().await {
            yt_version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        }
    }

    let mut ffmpeg_version = "No instalado".to_string();
    if ffmpeg_path.exists() {
        let mut cmd = Command::new(&ffmpeg_path);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        if let Ok(output) = cmd.arg("-version").output().await {
            let out_str = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = out_str.lines().next() {
                ffmpeg_version = line.replace("ffmpeg version ", "").split_whitespace().next().unwrap_or("").to_string();
            }
        }
    }

    Ok(serde_json::json!({
        "yt_dlp": yt_version,
        "ffmpeg": ffmpeg_version
    }))
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
        if err_str.contains("Could not copy") && err_str.contains("cookie database") {
            return Err("No se pudieron leer las cookies. Cierra tu navegador antes de buscar o elige 'Ninguno' en Navegador.".to_string());
        }
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
            "2160p" => {
                cmd.arg("-S").arg("res:2160,ext:mp4:m4a");
            }
            "1080p" => {
                cmd.arg("-S").arg("res:1080,ext:mp4:m4a");
            }
            "720p" => {
                cmd.arg("-S").arg("res:720,ext:mp4:m4a");
            }
            _ => {
                cmd.arg("-S").arg("res,ext:mp4:m4a");
            }
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
                let err_msg = line.replace("ERROR:", "").trim().to_string();
                if err_msg.contains("Could not copy") && err_msg.contains("cookie database") {
                    last_err = "No se pudieron leer las cookies. Cierra el navegador seleccionado o elige 'Ninguno'.".to_string();
                } else {
                    last_err = err_msg;
                }
            }
        }
        last_err
    });

    let mut reader = BufReader::new(stdout).lines();
    let mut downloaded_something = false;
    let mut last_percent = 0.0;
    let mut last_downloaded = String::new();
    let mut last_size = String::new();

    while let Ok(Some(line)) = reader.next_line().await {
        if line.starts_with("[download]") && line.contains("%") {
            downloaded_something = true;
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

            // Calcular el peso descargado actual
            let mut downloaded = String::new();
            if !size.is_empty() && percent > 0.0 {
                let num_str: String = size.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
                let unit_str: String = size.chars().skip_while(|c| c.is_ascii_digit() || *c == '.').collect();
                if let Ok(num) = num_str.parse::<f64>() {
                    let current_downloaded = num * (percent / 100.0);
                    downloaded = format!("{:.2}{}", current_downloaded, unit_str);
                }
            }

            last_percent = percent;
            if !size.is_empty() {
                last_size = size.clone();
            }
            if !downloaded.is_empty() {
                last_downloaded = downloaded.clone();
            }

            let _ = app.emit("download-progress", VideoProgress {
                percent,
                downloaded,
                size,
                speed,
                eta,
                status: "Descargando...".to_string(),
            });
        } else if line.contains("[merger]") || line.contains("Merging formats") {
            let _ = app.emit("download-progress", VideoProgress {
                percent: last_percent,
                downloaded: last_downloaded.clone(),
                size: last_size.clone(),
                speed: "-".to_string(),
                eta: "-".to_string(),
                status: "Fusionando pistas...".to_string(),
            });
        } else if line.contains("has already been downloaded") {
            downloaded_something = true;
            let completed_size = if !last_size.is_empty() { last_size.clone() } else { "Completado".to_string() };
            let _ = app.emit("download-progress", VideoProgress {
                percent: 100.0,
                downloaded: completed_size.clone(),
                size: completed_size,
                speed: "-".to_string(),
                eta: "-".to_string(),
                status: "Ya descargado".to_string(),
            });
        } else if line.contains("[ExtractInfo]") || line.contains("Extracting URL") {
            let _ = app.emit("download-progress", VideoProgress {
                percent: last_percent,
                downloaded: last_downloaded.clone(),
                size: last_size.clone(),
                speed: "-".to_string(),
                eta: "-".to_string(),
                status: "Extrayendo metadatos...".to_string(),
            });
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let last_error = err_task.await.unwrap_or_default();

    if status.success() || (playlist && downloaded_something) {
        let final_size = if !last_size.is_empty() { last_size.clone() } else { "Completado".to_string() };
        let _ = app.emit("download-progress", VideoProgress {
            percent: 100.0,
            downloaded: final_size.clone(),
            size: final_size,
            speed: "-".to_string(),
            eta: "00:00".to_string(),
            status: "Completado".to_string(),
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            check_and_download_engines,
            update_engines,
            get_video_info,
            start_download,
            get_history,
            save_history,
            get_engine_versions,
            read_clipboard,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
