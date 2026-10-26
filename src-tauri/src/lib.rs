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
    current_item: Option<String>,
    total_items: Option<String>,
    item_title: Option<String>,
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

static CURRENT_PID: std::sync::Mutex<Option<u32>> = std::sync::Mutex::new(None);

fn kill_active_process() {
    if let Ok(mut lock) = CURRENT_PID.lock() {
        if let Some(pid) = lock.take() {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(0x08000000)
                    .output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .output();
            }
        }
    }
}

fn configure_cmd_environment(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
        let node_dir = std::path::Path::new(r"C:\Program Files\nodejs");
        if node_dir.exists() {
            if let Ok(current_path) = std::env::var("PATH") {
                if !current_path.to_lowercase().contains("nodejs") {
                    cmd.env("PATH", format!("{};{}", node_dir.display(), current_path));
                }
            }
        }
    }
    cmd.arg("--js-runtimes").arg("node");
}

fn is_youtube_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains("youtube.com") || lower.contains("youtu.be")
}

#[tauri::command]
async fn cancel_download(app: AppHandle) -> Result<(), String> {
    kill_active_process();
    let _ = app.emit("download-progress", VideoProgress {
        percent: 0.0,
        downloaded: "".to_string(),
        size: "".to_string(),
        speed: "-".to_string(),
        eta: "--:--".to_string(),
        status: "Descarga cancelada por el usuario".to_string(),
        current_item: None,
        total_items: None,
        item_title: None,
    });
    Ok(())
}

#[tauri::command]
async fn get_video_info(app: AppHandle, url: String, browser: String) -> Result<serde_json::Value, String> {
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let yt_path = data_dir.join("yt-dlp.exe");

    let is_yt = is_youtube_url(&url);
    let try_with_cookies_first = !is_yt && browser != "none";

    let fetch_json = |use_cookies: bool| {
        let yt_path_clone = yt_path.clone();
        let url_clone = url.clone();
        let browser_clone = browser.clone();
        async move {
            let mut cmd = Command::new(&yt_path_clone);
            configure_cmd_environment(&mut cmd);
            cmd.arg("-j").arg("--no-playlist");

            if use_cookies && browser_clone != "none" {
                cmd.arg("--cookies-from-browser").arg(&browser_clone);
            }

            cmd.arg(&url_clone).output().await
        }
    };

    let first_res = fetch_json(try_with_cookies_first).await.map_err(|e| e.to_string())?;
    if first_res.status.success() {
        let json_str = String::from_utf8_lossy(&first_res.stdout);
        let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
        return Ok(parsed);
    }

    let err_str = String::from_utf8_lossy(&first_res.stderr).to_string();

    let retry_cookies = if try_with_cookies_first {
        false
    } else {
        (err_str.contains("Sign in to confirm") || err_str.contains("login") || err_str.contains("private") || err_str.contains("age")) && browser != "none"
    };

    if retry_cookies != try_with_cookies_first {
        let second_res = fetch_json(retry_cookies).await.map_err(|e| e.to_string())?;
        if second_res.status.success() {
            let json_str = String::from_utf8_lossy(&second_res.stdout);
            let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
            return Ok(parsed);
        }
    }

    if err_str.contains("Could not copy") && err_str.contains("cookie database") {
        return Err("No se pudieron leer las cookies del navegador (base de datos bloqueada). Intenta cerrar tu navegador o seleccionar 'Ninguno'.".to_string());
    }
    Err(format!("Error obteniendo información: {}", err_str.trim()))
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

    // Terminar de inmediato cualquier proceso previo residual para evitar bucles o descargas duplicadas
    kill_active_process();

    let temp_dir = data_dir.join("temp");
    if !temp_dir.exists() {
        let _ = create_dir_all(&temp_dir).await;
    } else {
        // Limpiar archivos residuales previos en la carpeta temporal
        if let Ok(mut entries) = tokio::fs::read_dir(&temp_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }

    let is_yt = is_youtube_url(&url);
    let use_cookies_initial = !is_yt && browser != "none";

    let execute_download = |use_cookies: bool| {
        let yt_path = yt_path.clone();
        let ffmpeg_path = ffmpeg_path.clone();
        let app = app.clone();
        let url = url.clone();
        let format = format.clone();
        let quality = quality.clone();
        let dest_folder = dest_folder.clone();
        let browser = browser.clone();
        let temp_dir = temp_dir.clone();

        async move {
            let mut cmd = Command::new(&yt_path);
            configure_cmd_environment(&mut cmd);
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

            // Aislamiento total de fragmentos temporales:
            // Todos los .part, .part-FragXXXX y .ytdl van a la carpeta temp de AppData y NO a la carpeta del usuario
            cmd.arg("-P").arg(format!("home:{}", dest_folder));
            cmd.arg("-P").arg(format!("temp:{}", temp_dir.display()));
            cmd.arg("--no-keep-fragments");

            // 4 conexiones concurrentes es el balance óptimo: descarga ultra rápida sin colapsar el disco ni saturar el PC
            cmd.arg("-N").arg("4")
               .arg("--retries").arg("10")
               .arg("--fragment-retries").arg("10")
               .arg("--no-mtime")
               .arg("--buffer-size").arg("16K")
               .arg("--newline");

            if ffmpeg_path.exists() {
                cmd.arg("--ffmpeg-location").arg(&ffmpeg_path);
            }

            if use_cookies && browser != "none" {
                cmd.arg("--cookies-from-browser").arg(&browser);
            }

            if !playlist {
                cmd.arg("--no-playlist");
                cmd.arg("-o").arg("%(title)s.%(ext)s");
            } else {
                cmd.arg("--yes-playlist")
                   .arg("--lazy-playlist")
                   .arg("--ignore-errors");
                cmd.arg("-o").arg("%(playlist_title&{}/|)s%(playlist_index&{} - |)s%(title)s.%(ext)s");
            }

            if format == "audio" {
                let audio_q = match quality.as_str() {
                    "320k" | "best" | "audio-best" => "0",
                    "256k" => "2",
                    "192k" => "4",
                    "128k" => "5",
                    _ => "0",
                };
                cmd.arg("-x").arg("--audio-format").arg("mp3").arg("--audio-quality").arg(audio_q);
            } else {
                match quality.as_str() {
                    "2160p" => {
                        cmd.arg("-S").arg("res:2160,ext:mp4:m4a");
                    }
                    "1440p" => {
                        cmd.arg("-S").arg("res:1440,ext:mp4:m4a");
                    }
                    "1080p" => {
                        cmd.arg("-S").arg("res:1080,ext:mp4:m4a");
                    }
                    "720p" => {
                        cmd.arg("-S").arg("res:720,ext:mp4:m4a");
                    }
                    "480p" => {
                        cmd.arg("-S").arg("res:480,ext:mp4:m4a");
                    }
                    _ => {
                        cmd.arg("-S").arg("res,ext:mp4:m4a");
                    }
                };
            }

            cmd.arg(&url);

            let mut child = cmd.spawn().map_err(|e| e.to_string())?;
            if let Some(pid) = child.id() {
                if let Ok(mut lock) = CURRENT_PID.lock() {
                    *lock = Some(pid);
                }
            }

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
            let mut stable_size_val = 0.0f64;
            let mut stable_size_unit = String::new();
            let mut playlist_item_status = String::new();
            let mut current_item_num: Option<String> = None;
            let mut total_items_num: Option<String> = None;
            let mut current_video_title: Option<String> = None;
            let mut last_emit_time = std::time::Instant::now();

            while let Ok(Some(line)) = reader.next_line().await {
                if line.contains("Downloading item ") || line.contains("Downloading video ") {
                    if let Some(idx) = line.find("Downloading ") {
                        let segment = line[idx..].trim();
                        let clean_seg = segment.replace("Downloading item ", "").replace("Downloading video ", "");
                        let split_parts: Vec<&str> = clean_seg.split(" of ").collect();
                        if split_parts.len() == 2 {
                            current_item_num = Some(split_parts[0].trim().to_string());
                            total_items_num = Some(split_parts[1].trim().to_string());
                            playlist_item_status = format!("Elemento {} de {}", split_parts[0].trim(), split_parts[1].trim());
                        }
                    }
                } else if line.contains("Destination: ") {
                    if let Some(idx) = line.find("Destination: ") {
                        let path_str = line[idx + 13..].trim();
                        let path = std::path::Path::new(path_str);
                        if let Some(file_name) = path.file_stem() {
                            current_video_title = Some(file_name.to_string_lossy().to_string());
                        }
                    }
                }

                if line.starts_with("[download]") && line.contains("%") {
                    downloaded_something = true;
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    let mut percent = 0.0;
                    let mut raw_size = String::new();
                    let mut speed = String::new();
                    let mut eta = String::new();

                    for (i, p) in parts.iter().enumerate() {
                        let p_clean = p.replace("~", "");
                        if p_clean.ends_with("%") {
                            percent = p_clean.replace("%", "").parse().unwrap_or(0.0);
                        } else if p_clean.contains("/s") {
                            speed = p_clean;
                        } else if p_clean == "of" && i + 1 < parts.len() {
                            let next_val = parts[i + 1].replace("~", "");
                            if next_val.contains("B") {
                                raw_size = next_val;
                            } else if i + 2 < parts.len() {
                                let second_val = parts[i + 2].replace("~", "");
                                if second_val.contains("B") {
                                    raw_size = second_val;
                                }
                            }
                        } else if p_clean == "ETA" && i + 1 < parts.len() {
                            eta = parts[i + 1].replace("~", "");
                        }
                    }

                    if raw_size.is_empty() {
                        for p in parts.iter() {
                            let p_clean = p.replace("~", "");
                            if (p_clean.ends_with("MiB") || p_clean.ends_with("GiB") || p_clean.ends_with("KiB") || p_clean.ends_with("B")) && !p_clean.contains("/s") && !p_clean.contains("%") {
                                raw_size = p_clean;
                                break;
                            }
                        }
                    }

                    // Estabilizar el total para evitar parpadeos visuales
                    if !raw_size.is_empty() {
                        let num_str: String = raw_size.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
                        let unit_str: String = raw_size.chars().skip_while(|c| c.is_ascii_digit() || *c == '.').collect();
                        if let Ok(new_val) = num_str.parse::<f64>() {
                            if stable_size_val == 0.0 || (new_val - stable_size_val).abs() / stable_size_val > 0.05 || stable_size_unit != unit_str {
                                stable_size_val = new_val;
                                stable_size_unit = unit_str.clone();
                            }
                        }
                    }

                    let stable_size_str = if stable_size_val > 0.0 {
                        format!("{:.2}{}", stable_size_val, stable_size_unit)
                    } else if !raw_size.is_empty() {
                        raw_size
                    } else {
                        last_size.clone()
                    };

                    // Calcular descargado en base al total estabilizado
                    let downloaded = if stable_size_val > 0.0 && percent > 0.0 {
                        let current_dl = stable_size_val * (percent / 100.0);
                        format!("{:.2}{}", current_dl, stable_size_unit)
                    } else {
                        String::new()
                    };

                    last_percent = percent;
                    if !stable_size_str.is_empty() {
                        last_size = stable_size_str.clone();
                    }
                    if !downloaded.is_empty() {
                        last_downloaded = downloaded.clone();
                    }

                    let status_text = if !playlist_item_status.is_empty() {
                        format!("Descargando {}...", playlist_item_status)
                    } else {
                        "Descargando...".to_string()
                    };

                    // Throttle de eventos para que la UI no sufra jitter ni parpadee
                    let now = std::time::Instant::now();
                    if now.duration_since(last_emit_time).as_millis() >= 120 || percent >= 100.0 {
                        last_emit_time = now;
                        let _ = app.emit("download-progress", VideoProgress {
                            percent,
                            downloaded,
                            size: stable_size_str,
                            speed,
                            eta,
                            status: status_text,
                            current_item: current_item_num.clone(),
                            total_items: total_items_num.clone(),
                            item_title: current_video_title.clone(),
                        });
                    }
                } else if line.contains("[merger]") || line.contains("Merging formats") {
                    let _ = app.emit("download-progress", VideoProgress {
                        percent: last_percent,
                        downloaded: last_downloaded.clone(),
                        size: last_size.clone(),
                        speed: "-".to_string(),
                        eta: "-".to_string(),
                        status: "Fusionando pistas...".to_string(),
                        current_item: current_item_num.clone(),
                        total_items: total_items_num.clone(),
                        item_title: current_video_title.clone(),
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
                        current_item: current_item_num.clone(),
                        total_items: total_items_num.clone(),
                        item_title: current_video_title.clone(),
                    });
                } else if line.contains("[ExtractInfo]") || line.contains("Extracting URL") {
                    let _ = app.emit("download-progress", VideoProgress {
                        percent: last_percent,
                        downloaded: last_downloaded.clone(),
                        size: last_size.clone(),
                        speed: "-".to_string(),
                        eta: "-".to_string(),
                        status: "Extrayendo metadatos...".to_string(),
                        current_item: current_item_num.clone(),
                        total_items: total_items_num.clone(),
                        item_title: current_video_title.clone(),
                    });
                }
            }

            let status = child.wait().await.map_err(|e| e.to_string())?;
            let last_error = err_task.await.unwrap_or_default();

            if let Ok(mut lock) = CURRENT_PID.lock() {
                *lock = None;
            }

            // Limpiar archivos temporales residuales tras finalizar
            if let Ok(mut entries) = tokio::fs::read_dir(&temp_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let _ = tokio::fs::remove_file(entry.path()).await;
                }
            }

            if status.success() || (playlist && downloaded_something) {
                let final_size = if !last_size.is_empty() { last_size.clone() } else { "Completado".to_string() };
                let _ = app.emit("download-progress", VideoProgress {
                    percent: 100.0,
                    downloaded: final_size.clone(),
                    size: final_size,
                    speed: "-".to_string(),
                    eta: "00:00".to_string(),
                    status: "Completado".to_string(),
                    current_item: current_item_num.clone(),
                    total_items: total_items_num.clone(),
                    item_title: current_video_title.clone(),
                });
                Ok(())
            } else {
                Err(if !last_error.is_empty() {
                    last_error
                } else {
                    "Error en la descarga. Verifica la URL o tu conexión.".to_string()
                })
            }
        }
    };

    let first_attempt = execute_download(use_cookies_initial).await;
    match first_attempt {
        Ok(()) => Ok(()),
        Err(err) => {
            // Si falló el primer intento con cookies (o por bloqueo de base de datos de cookies de Firefox),
            // reintentar automáticamente sin cookies.
            if use_cookies_initial {
                let retry_res = execute_download(false).await;
                if retry_res.is_ok() {
                    return Ok(());
                }
            } else if is_yt && browser != "none" && (err.contains("Sign in to confirm") || err.contains("age") || err.contains("login") || err.contains("private")) {
                let retry_res = execute_download(true).await;
                if retry_res.is_ok() {
                    return Ok(());
                }
            }
            Err(err)
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
            cancel_download,
            get_history,
            save_history,
            get_engine_versions,
            read_clipboard,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
