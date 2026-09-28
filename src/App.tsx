import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { 
  Download, Settings, ClipboardPaste, 
  CheckCircle2, Folder, Film, MonitorPlay, 
  Video, Music, HardDrive, Clock, Globe, X, AlertCircle, Info, Trash2
} from "lucide-react";
import { downloadDir } from '@tauri-apps/api/path';
import { readText } from '@tauri-apps/plugin-clipboard-manager';

function App() {
  const [url, setUrl] = useState("");
  const activeDownloadRef = useRef<{ url: string; title: string; format: string; quality: string }>({
    url: "",
    title: "",
    format: "",
    quality: ""
  });
  const [format, setFormat] = useState(() => localStorage.getItem('vplus_format') || "video");
  const [quality, setQuality] = useState(() => localStorage.getItem('vplus_quality') || "1080p");
  const [browser, setBrowser] = useState(() => localStorage.getItem('vplus_browser') || "firefox");
  const [destFolder, setDestFolder] = useState(() => localStorage.getItem('vplus_destFolder') || "");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [infoError, setInfoError] = useState("");
  const [progress, setProgress] = useState(0);
  const [playlist, setPlaylist] = useState(false);
  const [stats, setStats] = useState({ downloaded: "", size: "0 MB", speed: "0 MB/s", eta: "--:--", status: "" });
  const [lastDownload, setLastDownload] = useState<any>(() => {
    try {
      return JSON.parse(localStorage.getItem('vplus_last_download') || 'null');
    } catch {
      return null;
    }
  });
  const [pasteStatus, setPasteStatus] = useState<'idle' | 'pasted' | 'empty'>('idle');
  const [engineStatus, setEngineStatus] = useState("Verificando motores...");
  const [history, setHistory] = useState<any[]>([]);

  const [videoInfo, setVideoInfo] = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updatingEngines, setUpdatingEngines] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [versions, setVersions] = useState({ yt_dlp: "Cargando...", ffmpeg: "Cargando..." });

  useEffect(() => {
    // Escuchar progreso de descarga de motores
    const unlistenEngine = listen<any>("engine-download-progress", (event) => {
      setEngineStatus(`Actualizando yt-dlp... ${event.payload.progress.toFixed(1)}%`);
    });

    // Escuchar progreso del video
    const unlistenVideo = listen<any>("download-progress", (event) => {
      const p = event.payload;
      setProgress(p.percent);
      setStats({
        downloaded: p.downloaded || "",
        size: p.size,
        speed: p.speed,
        eta: p.eta,
        status: p.status
      });
      if (p.percent === 100) {
        setDownloading(false);
        saveToHistory();
        setShowNotification(true);
        const current = activeDownloadRef.current;
        const finalInfo = {
          title: current.title || url,
          url: current.url || url,
          size: p.size && p.size !== "Completado" ? p.size : (p.downloaded || stats.size),
          format: current.format,
          quality: current.quality,
          destFolder: localStorage.getItem('vplus_destFolder') || destFolder,
          date: new Date().toISOString()
        };
        setLastDownload(finalInfo);
        localStorage.setItem('vplus_last_download', JSON.stringify(finalInfo));
      }
    });

    // Iniciar copia de motores de resources a local app data
    invoke("check_and_download_engines").then(() => {
      setEngineStatus("Motor Local: yt-dlp Listo ✅");
    }).catch(err => {
      setEngineStatus(`Error de motores: ${err}`);
    });

    // Cargar historial
    invoke("get_history").then((res: any) => {
      try { 
        const parsed = JSON.parse(res);
        setHistory(parsed);
        if (!localStorage.getItem('vplus_last_download') && Array.isArray(parsed) && parsed.length > 0) {
          const last = parsed[parsed.length - 1];
          setLastDownload(last);
        }
      } catch(e) {}
    });

    // Cargar directorio de descargas por defecto si está vacío
    if (!localStorage.getItem('vplus_destFolder')) {
      downloadDir().then(dir => setDestFolder(dir + "VideoPlus"));
    }

    return () => {
      unlistenVideo.then(f => f());
      unlistenEngine.then(f => f());
    }
  }, []);

  useEffect(() => { localStorage.setItem('vplus_format', format); }, [format]);
  useEffect(() => { localStorage.setItem('vplus_quality', quality); }, [quality]);
  useEffect(() => { localStorage.setItem('vplus_browser', browser); }, [browser]);
  useEffect(() => { if (destFolder) localStorage.setItem('vplus_destFolder', destFolder); }, [destFolder]);

  const handleUpdateApp = async () => {
    try {
      setUpdatingApp(true);
      setEngineStatus("Buscando actualizaciones...");
      let updateFound = false;

      // 1. Intentar primero con el actualizador nativo de Tauri
      try {
        const update = await check();
        if (update) {
          updateFound = true;
          setEngineStatus(`Descargando actualización v${update.version}...`);
          await update.downloadAndInstall();
          setEngineStatus("Actualización instalada. Reiniciando...");
          await relaunch();
          return;
        }
      } catch (updaterErr) {
        console.warn("Tauri updater check no pudo completarse:", updaterErr);
      }

      // 2. Comprobación de respaldo contra la API de GitHub Releases
      try {
        const response = await fetch("https://api.github.com/repos/XChris-Z/VideoPlus/releases/latest");
        if (response.ok) {
          const data = await response.json();
          const remoteTag = data.tag_name || "";
          const currentVersion = "v1.0.13";
          
          if (remoteTag && remoteTag !== currentVersion) {
            updateFound = true;
            setEngineStatus(`Nueva versión ${remoteTag} disponible en GitHub`);
            if (data.html_url) {
              await openUrl(data.html_url);
            }
            return;
          }
        }
      } catch (ghErr) {
        console.warn("GitHub API check falló:", ghErr);
      }

      if (!updateFound) {
        setEngineStatus("Ya tienes la última versión (v1.0.13) ✅");
      }
    } catch (e: any) {
      console.error(e);
      setEngineStatus("No se pudo verificar la actualización.");
    } finally {
      setUpdatingApp(false);
    }
  };

  const handleUpdateEngines = async () => {
    try {
      setUpdatingEngines(true);
      setEngineStatus("Descargando nuevo yt-dlp...");
      await invoke("update_engines");
      setEngineStatus("Motor actualizado con éxito ✅");
    } catch (e) {
      console.error(e);
      setEngineStatus(`Error actualizando motor: ${e}`);
    } finally {
      setUpdatingEngines(false);
    }
  };

  const saveToHistory = async () => {
    const current = activeDownloadRef.current;
    if (!current.url) return;

    try {
      const raw: any = await invoke("get_history");
      let currentHistory: any[] = [];
      try {
        currentHistory = JSON.parse(raw);
        if (!Array.isArray(currentHistory)) currentHistory = [];
      } catch {
        currentHistory = [];
      }

      // Evitar guardar duplicado si la última descarga es idéntica en menos de 10s
      const lastEntry = currentHistory[currentHistory.length - 1];
      if (lastEntry && lastEntry.url === current.url && (Date.now() - new Date(lastEntry.date).getTime() < 10000)) {
        return;
      }

      const newEntry = {
        url: current.url,
        format: current.format,
        quality: current.quality,
        date: new Date().toISOString(),
        title: current.title || current.url,
        size: stats.size && stats.size !== "0 MB" && stats.size !== "Completado" && stats.size !== "Calculando..." ? stats.size : (stats.downloaded || undefined),
        destFolder: localStorage.getItem('vplus_destFolder') || destFolder
      };

      const newHistory = [...currentHistory, newEntry];
      setHistory(newHistory);
      await invoke("save_history", { historyJson: JSON.stringify(newHistory) });
    } catch (err) {
      console.error("Error guardando historial:", err);
    }
  };

  const handleClearHistory = async () => {
    setHistory([]);
    await invoke("save_history", { historyJson: "[]" });
  };

  const fetchVideoInfo = async (targetUrl: string, targetBrowser: string) => {
    if (!targetUrl || !targetUrl.startsWith("http")) return;
    setLoadingInfo(true);
    setVideoInfo(null);
    setInfoError("");
    try {
      const info: any = await invoke("get_video_info", { url: targetUrl, browser: targetBrowser });
      setVideoInfo({
        title: info.title || "Video Desconocido",
        uploader: info.uploader || info.extractor_key || "Canal Desconocido",
        thumbnail: info.thumbnail || "",
        duration: info.duration_string || "--:--"
      });
    } catch (error: any) {
      console.error("Error fetching video info", error);
      setInfoError(error.toString());
    } finally {
      setLoadingInfo(false);
    }
  };

  const handleShowAbout = async () => {
    setShowAbout(true);
    try {
      const res: any = await invoke("get_engine_versions");
      setVersions(res);
    } catch (e) {
      setVersions({ yt_dlp: "Error", ffmpeg: "Error" });
    }
  };

  useEffect(() => {
    if (url && url.startsWith("http")) {
      fetchVideoInfo(url, browser);
    }
  }, [browser]);

  const handlePaste = async () => {
    try {
      let text = "";
      // 1. Lectura nativa directa con Win32 API en Rust (arboard + PowerShell fallback) - 100% inmune a restricciones de Edge WebView2
      try {
        const nativeText = await invoke<string>("read_clipboard");
        if (nativeText && nativeText.trim()) {
          text = nativeText.trim();
        }
      } catch (nativeErr) {
        console.warn("Lectura nativa Rust aviso:", nativeErr);
      }

      // 2. Respaldo plugin clipboard-manager de Tauri
      if (!text) {
        try {
          const tauriText = await readText();
          if (tauriText && tauriText.trim()) {
            text = tauriText.trim();
          }
        } catch (tauriErr) {
          console.warn("Tauri clipboard plugin fallo:", tauriErr);
        }
      }

      // 3. Respaldo API de navegador
      if (!text && navigator.clipboard && navigator.clipboard.readText) {
        try {
          const webText = await navigator.clipboard.readText();
          if (webText && webText.trim()) {
            text = webText.trim();
          }
        } catch {}
      }

      if (text) {
        const clean = text.trim();
        setUrl(clean);
        setPasteStatus('pasted');
        setTimeout(() => setPasteStatus('idle'), 2000);
        if (clean.startsWith("http")) {
          fetchVideoInfo(clean, browser);
        }
      } else {
        setPasteStatus('empty');
        setTimeout(() => setPasteStatus('idle'), 2000);
      }
    } catch (err) {
      console.error("Failed to read clipboard contents: ", err);
      setPasteStatus('empty');
      setTimeout(() => setPasteStatus('idle'), 2000);
    }
  };

  const handleUrlChange = (e: any) => {
    const newUrl = e.target.value;
    setUrl(newUrl);
    if (newUrl.startsWith("http")) {
       fetchVideoInfo(newUrl, browser);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Seleccionar carpeta de descarga'
      });
      if (selected && typeof selected === 'string') {
        setDestFolder(selected);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDownload = async () => {
    if (!url) return;
    activeDownloadRef.current = {
      url,
      title: videoInfo?.title || url,
      format,
      quality
    };
    setDownloading(true);
    setDownloadError("");
    setProgress(0);
    setStats({ downloaded: "", size: "Calculando...", speed: "-", eta: "--:--", status: "Iniciando..." });

    try {
      await invoke("start_download", {
        url,
        format,
        quality,
        destFolder,
        playlist: playlist,
        browser
      });
      // Asegurar registro garantizado al completarse
      saveToHistory();
    } catch (error: any) {
      console.error(error);
      setDownloadError(error.toString());
    } finally {
      setDownloading(false);
    }
  };

  const getPlatformColor = () => {
    if (!url) return "bg-violet-600 hover:bg-violet-700 shadow-[0_0_20px_rgba(124,58,237,0.3)] hover:shadow-[0_0_30px_rgba(124,58,237,0.5)]";
    if (url.includes("youtube.com") || url.includes("youtu.be")) return "bg-red-600 hover:bg-red-700 shadow-[0_0_20px_rgba(220,38,38,0.3)] hover:shadow-[0_0_30px_rgba(220,38,38,0.5)]";
    if (url.includes("twitter.com") || url.includes("x.com")) return "bg-sky-600 hover:bg-sky-700 shadow-[0_0_20px_rgba(2,132,199,0.3)] hover:shadow-[0_0_30px_rgba(2,132,199,0.5)]";
    if (url.includes("instagram.com") || url.includes("facebook.com")) return "bg-pink-600 hover:bg-pink-700 shadow-[0_0_20px_rgba(219,39,119,0.3)] hover:shadow-[0_0_30px_rgba(219,39,119,0.5)]";
    if (url.includes("tiktok.com")) return "bg-black hover:bg-zinc-900 border border-zinc-700 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]";
    return "bg-violet-600 hover:bg-violet-700 shadow-[0_0_20px_rgba(124,58,237,0.3)] hover:shadow-[0_0_30px_rgba(124,58,237,0.5)]";
  };

  const getPlatformProgressColor = () => {
    if (!url) return "bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)]";
    if (url.includes("youtube.com") || url.includes("youtu.be")) return "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]";
    if (url.includes("twitter.com") || url.includes("x.com")) return "bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.8)]";
    if (url.includes("instagram.com") || url.includes("facebook.com")) return "bg-pink-500 shadow-[0_0_10px_rgba(236,72,153,0.8)]";
    if (url.includes("tiktok.com")) return "bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]";
    return "bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)]";
  };

  const getPlatformGlow = () => {
    if (!url) return "focus-within:border-violet-500/50";
    if (url.includes("youtube.com") || url.includes("youtu.be")) return "focus-within:border-red-500/50";
    if (url.includes("twitter.com") || url.includes("x.com")) return "focus-within:border-sky-500/50";
    if (url.includes("instagram.com") || url.includes("facebook.com")) return "focus-within:border-pink-500/50";
    if (url.includes("tiktok.com")) return "focus-within:border-zinc-500/50";
    return "focus-within:border-violet-500/50";
  };

  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col font-sans select-none relative overflow-hidden">
      <AnimatePresence>
        {/* Non-invasive Notification */}
        {showNotification && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-end justify-center pb-8 pointer-events-auto" 
            onClick={() => setShowNotification(false)}
          >
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="bg-emerald-950/70 border border-emerald-500/30 text-emerald-100 px-6 py-4 rounded-2xl shadow-[0_10px_40px_rgba(16,185,129,0.2)] flex items-center gap-4 backdrop-blur-xl cursor-pointer hover:bg-emerald-900/70 transition-colors"
            >
              <CheckCircle2 className="text-emerald-400" size={24} />
              <div>
                <h3 className="font-semibold text-emerald-300">¡Descarga Completada!</h3>
                <p className="text-xs opacity-80">Haz clic en cualquier parte para cerrar esto.</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {/* About Modal */}
        {showAbout && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-[100] bg-black/40 backdrop-blur-md flex items-center justify-center p-4" 
            onClick={() => setShowAbout(false)}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              className="bg-zinc-900/80 backdrop-blur-2xl border border-white/10 rounded-2xl w-full max-w-sm flex flex-col shadow-2xl overflow-hidden pointer-events-auto" 
              onClick={e => e.stopPropagation()}
            >
            <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
              <h2 className="font-semibold text-lg flex items-center gap-2"><Info size={18} className="text-violet-400"/> Información y Versiones</h2>
              <button onClick={() => setShowAbout(false)} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center gap-4 mb-2">
                <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center shadow-lg">
                  <Download className="text-white" size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-zinc-100 text-lg">VideoPlus</h3>
                  <p className="text-xs text-zinc-400 font-mono">v1.0.13</p>
                </div>
              </div>
              
              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 flex flex-col gap-3">
                <div className="flex justify-between items-center border-b border-zinc-800/50 pb-2">
                  <span className="text-sm font-medium text-zinc-300">Motor (yt-dlp)</span>
                  <span className="text-xs font-mono bg-zinc-800 px-2 py-1 rounded text-violet-300">{versions.yt_dlp}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-800/50 pb-2">
                  <span className="text-sm font-medium text-zinc-300">Conversor (ffmpeg)</span>
                  <span className="text-xs font-mono bg-zinc-800 px-2 py-1 rounded text-sky-300">{versions.ffmpeg}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-zinc-300">Sistema Operativo</span>
                  <span className="text-xs font-mono bg-zinc-800 px-2 py-1 rounded text-zinc-400">Windows</span>
                </div>
              </div>
              <p className="text-xs text-center text-zinc-500 mt-2">
                Desarrollado por XChris-Z
              </p>
            </div>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {/* History Modal */}
        {showHistory && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-[100] bg-black/40 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              className="bg-zinc-900/80 backdrop-blur-2xl border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
            >
            <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
              <h2 className="font-semibold text-lg flex items-center gap-2"><Clock size={18}/> Historial de Descargas</h2>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <button 
                    onClick={handleClearHistory}
                    className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-md cursor-pointer transition-all active:scale-95"
                    title="Vaciar todo el historial"
                  >
                    <Trash2 size={13} /> Limpiar Historial
                  </button>
                )}
                <button onClick={() => setShowHistory(false)} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 cursor-pointer">
                  Cerrar
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-4 flex-1">
              {history.length === 0 ? (
                <p className="text-zinc-500 text-center py-8">No hay descargas recientes.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {[...history].reverse().map((item, i) => (
                    <div 
                      key={i} 
                      className="flex flex-col gap-2 p-4 bg-zinc-950/80 rounded-xl border border-zinc-800 hover:border-violet-500/30 transition-colors w-full min-w-0 overflow-hidden box-border"
                    >
                      <h4 
                        className="font-semibold text-sm text-zinc-100 leading-snug w-full min-w-0 select-text"
                        style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}
                      >
                        {item.title || "Video sin título"}
                      </h4>
                      <div className="flex items-center gap-2 text-xs text-zinc-400 w-full min-w-0">
                        <Globe size={13} className="text-violet-400 shrink-0"/>
                        <span 
                          className="font-mono text-xs text-zinc-400 select-text line-clamp-2 w-full min-w-0"
                          style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}
                        >
                          {item.url || "URL desconocida"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-zinc-500 mt-1 border-t border-zinc-900/80 pt-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="bg-zinc-800 px-2 py-0.5 rounded text-violet-300 font-semibold">{item.format?.toUpperCase()}</span>
                          <span className="bg-zinc-800 px-2 py-0.5 rounded text-sky-300">{item.quality}</span>
                          {item.size && item.size !== "Completado" && item.size !== "0 MB" && (
                            <span className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono font-semibold">{item.size}</span>
                          )}
                          <span className="bg-zinc-800/80 px-2 py-0.5 rounded text-zinc-400">{new Date(item.date).toLocaleString()}</span>
                        </div>
                        {item.destFolder && (
                          <button
                            onClick={() => {
                              invoke("open_folder", { path: item.destFolder }).catch(() => {
                                openUrl(`file://${item.destFolder}`).catch(() => {});
                              });
                            }}
                            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-emerald-300 px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded transition-colors cursor-pointer"
                            title="Abrir carpeta donde se guardó"
                          >
                            <Folder size={12} className="text-emerald-400" /> Abrir Carpeta
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header (Draggable for Tauri) */}
      <div data-tauri-drag-region className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 sticky top-0 z-50">
        <div className="flex items-center gap-2 pointer-events-none">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
          <h1 className="font-semibold tracking-wide text-xs text-zinc-300 uppercase">{engineStatus}</h1>
        </div>
        <button onClick={handleShowAbout} className="text-zinc-400 hover:text-white p-1.5 rounded-md hover:bg-zinc-800 cursor-pointer active:scale-95 transition-all" title="Acerca de">
          <Info size={16} />
        </button>
      </div>

      <main className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 max-w-[1200px] mx-auto w-full">
        
        {/* BIG TITLE & DESCRIPTION */}
        <div className="flex justify-between items-start mb-2">
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-white uppercase drop-shadow-md">
              Universal Video Downloader
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
              <span>Descarga de</span>
              <span className="flex items-center gap-1 text-zinc-300"><Globe size={14}/> YouTube,</span>
              <span className="flex items-center gap-1 text-zinc-300">Instagram,</span>
              <span className="flex items-center gap-1 text-zinc-300">X/Twitter,</span>
              <span className="flex items-center gap-1 text-zinc-300">Facebook y más.</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <div className="flex gap-2">
              <button onClick={handleUpdateEngines} disabled={updatingEngines} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-all text-xs shadow-sm disabled:opacity-50 border border-zinc-700 cursor-pointer active:scale-95">
                {updatingEngines ? "Actualizando..." : "Actualizar Motor"}
              </button>
              <button onClick={handleUpdateApp} disabled={updatingApp} className="flex items-center gap-2 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/40 text-violet-300 border border-violet-500/30 rounded-md transition-all text-xs shadow-sm disabled:opacity-50 cursor-pointer active:scale-95">
                {updatingApp ? "Buscando..." : "Actualizar App"}
              </button>
            </div>
            <button onClick={() => setShowHistory(true)} className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg border border-zinc-700 transition-all font-medium text-sm shadow-sm w-full justify-center cursor-pointer active:scale-95">
              Ver Historial
            </button>
          </div>
        </div>

        {/* URL Input Section */}
        <section className={`bg-zinc-900 p-1 rounded-xl border border-zinc-800 flex items-center shadow-lg transition-colors ${getPlatformGlow()}`}>
          <div className="px-4 text-zinc-500">
            <Film size={20} />
          </div>
          <input 
            type="text" 
            value={url}
            onChange={handleUrlChange}
            placeholder="Pega la URL del video aquí (YouTube, TikTok, Twitter...)" 
            className="flex-1 bg-transparent border-none outline-none text-zinc-100 placeholder:text-zinc-600 py-4"
          />
          {url && (
            <div className="px-3 flex items-center gap-1 text-xs font-medium text-emerald-500 bg-emerald-500/10 rounded-full py-1 mr-3">
              <CheckCircle2 size={14} /> Listo
            </div>
          )}
          <button 
            onClick={() => { setUrl(""); setVideoInfo(null); setInfoError(""); setProgress(0); setDownloadError(""); }}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800/50 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg mr-2 transition-all font-medium text-sm cursor-pointer active:scale-95"
          >
            <X size={16} /> Limpiar
          </button>
          <button 
            type="button"
            onClick={handlePaste}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg mr-1 transition-all font-medium text-sm cursor-pointer active:scale-95 border ${
              pasteStatus === 'pasted'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)]' 
                : pasteStatus === 'empty'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700/60 shadow-sm'
            }`}
            title="Pegar enlace del portapapeles"
          >
            {pasteStatus === 'pasted' ? (
              <>
                <CheckCircle2 size={16} className="text-emerald-400" />
                <span className="font-semibold text-emerald-300">¡Pegado!</span>
              </>
            ) : pasteStatus === 'empty' ? (
              <>
                <AlertCircle size={16} className="text-amber-400" />
                <span className="font-semibold text-amber-300">¡Vacío!</span>
              </>
            ) : (
              <>
                <ClipboardPaste size={16} className="text-violet-400" />
                <span>Pegar</span>
              </>
            )}
          </button>
        </section>

        {/* Layout Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          
          {/* Preview Card */}
          <section className="md:col-span-5 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col shadow-lg relative group">
            <div className="aspect-video bg-zinc-950 flex items-center justify-center relative overflow-hidden">
              {videoInfo?.thumbnail ? (
                <img src={videoInfo.thumbnail} alt="Video thumbnail" className="w-full h-full object-cover" />
              ) : (
                <MonitorPlay size={48} className={loadingInfo ? "text-violet-500 animate-pulse" : "text-zinc-800"} />
              )}
              {/* Overlay on hover or when image is present */}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 to-transparent opacity-60"></div>
              <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded text-xs text-zinc-300 font-mono flex items-center gap-1 border border-zinc-800">
                <Clock size={12} /> {videoInfo?.duration || "--:--"}
              </div>
            </div>
            <div className="p-4 flex-1 flex flex-col gap-1">
              <h3 className="font-semibold text-zinc-200 line-clamp-2 leading-tight">
                {loadingInfo ? "Cargando información..." : (videoInfo?.title || "Esperando video...")}
              </h3>
              <div className="flex items-center justify-between mt-1">
                <p className="text-sm text-violet-400 font-medium">
                  {videoInfo?.uploader || "Autor / Canal"}
                </p>
                {history.some(h => h.url === url) && (
                  <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30">Ya descargado</span>
                )}
              </div>
              {infoError && (
                <div className="mt-2 text-xs text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20 max-h-24 overflow-y-auto">
                  <span className="font-semibold flex items-center gap-1"><AlertCircle size={14}/> Error de extracción:</span>
                  <span className="font-mono mt-1 opacity-80">{infoError}</span>
                </div>
              )}
            </div>
          </section>

          {/* Options Panel */}
          <section className="md:col-span-7 bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-lg flex flex-col gap-5">
            <div className="flex items-center gap-2 pb-3 border-b border-zinc-800/50">
              <Settings size={18} className="text-violet-500" />
              <h2 className="font-semibold text-zinc-200">Configuración de Descarga</h2>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Formato</label>
                <div className="flex bg-zinc-950 rounded-lg p-1 border border-zinc-800">
                  <button 
                    onClick={() => setFormat('video')}
                    className={`flex-1 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all ${format === 'video' ? 'bg-violet-600 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    <Video size={16} /> Video
                  </button>
                  <button 
                    onClick={() => setFormat('audio')}
                    className={`flex-1 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all ${format === 'audio' ? 'bg-violet-600 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    <Music size={16} /> Audio
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Calidad / Resol.</label>
                <select 
                  value={quality} 
                  onChange={(e) => setQuality(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-violet-500 transition-colors"
                >
                  <option value="best">Máxima Posible (Best)</option>
                  <option value="2160p">4K (2160p)</option>
                  <option value="1080p">Full HD (1080p)</option>
                  <option value="720p">HD (720p)</option>
                  <option value="audio-best">Solo Audio (Alta calidad)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Destino</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  readOnly 
                  value={destFolder}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 text-sm text-zinc-400 outline-none"
                />
                <button 
                  onClick={handleSelectFolder}
                  className="p-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-zinc-700 transition-all text-zinc-300 cursor-pointer active:scale-95"
                  title="Seleccionar carpeta"
                >
                  <Folder size={18} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-1">
              <div 
                className={`flex items-center justify-between p-3 rounded-lg border transition-all duration-300 cursor-pointer group select-none ${playlist ? 'bg-violet-900/30 border-violet-500/50 shadow-[0_0_15px_rgba(139,92,246,0.15)]' : 'bg-zinc-950/50 border-zinc-800/50 hover:border-zinc-700'}`}
                onClick={() => setPlaylist(!playlist)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-6 rounded-full p-1 transition-colors duration-300 ease-in-out flex items-center ${playlist ? 'bg-violet-500' : 'bg-zinc-700'}`}>
                    <motion.div 
                      layout
                      initial={false}
                      animate={{ x: playlist ? 20 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="w-4 h-4 bg-white rounded-full shadow-md"
                    />
                  </div>
                  <span className={`text-sm transition-colors duration-300 ${playlist ? 'text-violet-100 font-medium' : 'text-zinc-400 group-hover:text-zinc-300'}`}>Playlist Completa</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider whitespace-nowrap">Cookies:</label>
                <select 
                  value={browser} 
                  onChange={(e) => setBrowser(e.target.value)}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-violet-500 transition-colors"
                >
                  <option value="firefox">Firefox</option>
                  <option value="chrome">Chrome</option>
                  <option value="edge">Edge</option>
                  <option value="none">Ninguno</option>
                </select>
              </div>
            </div>

          </section>
        </div>

        {/* Action Section */}
        <section className="flex flex-col gap-4 mt-2">
          {/* Permanent Last Download Card */}
          {lastDownload && !downloading && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between p-4 bg-zinc-900/80 border border-emerald-500/25 rounded-2xl backdrop-blur-xl shadow-lg hover:border-emerald-500/40 transition-colors w-full min-w-0"
            >
              <div className="flex items-center gap-3.5 overflow-hidden pr-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0 shadow-inner">
                  <CheckCircle2 size={20} className="text-emerald-400" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      Último video descargado
                    </span>
                    {lastDownload.size && lastDownload.size !== "0 MB" && (
                      <span className="text-[11px] font-mono bg-zinc-800 text-violet-300 px-2 py-0.5 rounded font-semibold border border-violet-500/20">
                        {lastDownload.size}
                      </span>
                    )}
                  </div>
                  <span 
                    className="text-sm font-semibold text-zinc-100 truncate mt-0.5 select-text" 
                    title={lastDownload.title}
                  >
                    {lastDownload.title}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mt-0.5 font-mono">
                    <span className="bg-zinc-800/80 px-1.5 py-0.5 rounded text-zinc-300 text-[10px]">{lastDownload.format?.toUpperCase()}</span>
                    {lastDownload.quality && (
                      <span className="bg-zinc-800/80 px-1.5 py-0.5 rounded text-sky-300 text-[10px]">{lastDownload.quality}</span>
                    )}
                    <span>•</span>
                    <span className="text-zinc-400 text-[11px]">{new Date(lastDownload.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                    {lastDownload.destFolder && (
                      <>
                        <span>•</span>
                        <span className="text-zinc-500 text-[11px] truncate max-w-[280px]" title={lastDownload.destFolder}>{lastDownload.destFolder}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button 
                onClick={() => {
                  if (lastDownload.destFolder) {
                    invoke("open_folder", { path: lastDownload.destFolder }).catch(() => {
                      openUrl(`file://${lastDownload.destFolder}`).catch(() => {});
                    });
                  }
                }}
                className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold border border-zinc-700 transition-all shrink-0 cursor-pointer active:scale-95 flex items-center gap-2 shadow-sm ml-2"
                title="Abrir carpeta de destino"
              >
                <Folder size={15} className="text-emerald-400" /> Abrir Carpeta
              </button>
            </motion.div>
          )}

          <AnimatePresence>
            {(downloading || progress > 0 || downloadError) && (
              <motion.div 
                initial={{ opacity: 0, y: -20, scale: 0.95 }} 
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 350, damping: 25 }}
                className="flex flex-col gap-3 bg-zinc-900/80 backdrop-blur-xl p-5 rounded-2xl border border-white/5 shadow-xl"
              >
              {downloadError ? (
                <div className="bg-zinc-950 border border-red-500/30 rounded-xl overflow-hidden shadow-lg">
                  <div className="bg-red-500/10 px-4 py-2 flex items-center justify-between border-b border-red-500/20">
                    <div className="font-semibold flex items-center gap-2 text-red-400 text-sm"><AlertCircle size={16}/> Logs de Error</div>
                    <button 
                      onClick={() => navigator.clipboard.writeText(downloadError)}
                      className="text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 px-2 py-1 rounded transition-colors border border-red-500/30"
                    >
                      Copiar Logs
                    </button>
                  </div>
                  <div className="p-4 overflow-y-auto max-h-48 font-mono text-xs text-red-300/90 whitespace-pre-wrap break-all">
                    {downloadError}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-end">
                    <div className="flex flex-col gap-1 overflow-hidden pr-4">
                      <span className="text-xs font-mono text-zinc-500 mb-1">{stats.status || "Descargando..."}</span>
                      <span className="font-semibold text-zinc-200 line-clamp-1 truncate">{videoInfo?.title || url}</span>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="text-2xl font-bold text-zinc-100 font-mono">{progress > 0 ? `${progress}%` : '...'}</span>
                      {stats.downloaded && stats.size && stats.size !== "0 MB" && stats.size !== "Completado" && (
                        <span className="text-xs font-mono text-violet-300 font-semibold">
                          {stats.downloaded} / {stats.size}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="h-1.5 w-full bg-zinc-950 rounded-full overflow-hidden relative">
                    {progress === 0 ? (
                      <motion.div 
                        className={`h-full w-1/3 absolute rounded-full ${getPlatformProgressColor()}`}
                        animate={{ left: ["-30%", "100%"] }}
                        transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                      />
                    ) : (
                        <motion.div 
                          className={`h-full ${progress === 100 ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.8)]' : getPlatformProgressColor()}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ type: "spring", stiffness: 100, damping: 20 }}
                        />
                    )}
                  </div>

                  <div className="flex justify-between items-center text-xs text-zinc-400 font-mono mt-1">
                    <div className="flex gap-4">
                      <span className="flex items-center gap-1.5">
                        <HardDrive size={13} className="text-violet-400"/> 
                        {stats.downloaded && stats.size && stats.size !== "0 MB" && stats.size !== "Completado"
                          ? <span className="text-zinc-200 font-semibold">{stats.downloaded} de {stats.size}</span>
                          : (stats.size !== "0 MB" ? stats.size : "Calculando peso...")}
                      </span>
                      <span className="text-emerald-400 font-medium">{stats.speed}</span>
                    </div>
                    <span>ETA: {stats.eta !== "--:--" ? stats.eta : "N/A"}</span>
                  </div>
                </>
              )}
            </motion.div>
          )}
          </AnimatePresence>

          <button 
            onClick={handleDownload}
            disabled={downloading}
            className={`w-full py-5 rounded-xl font-bold text-lg tracking-wide flex items-center justify-center gap-3 transition-all ${
              downloading 
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
              : `text-white active:scale-[0.99] ${getPlatformColor()}`
            }`}
          >
            <Download size={24} />
            {downloading ? "DESCARGANDO..." : "INICIAR DESCARGA"}
          </button>
        </section>

      </main>

      {/* Footer */}
      <footer className="h-10 bg-zinc-950 border-t border-zinc-900 flex items-center justify-between px-4 text-xs">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full shadow-[0_0_5px_currentColor] ${engineStatus.includes('Listo') ? 'bg-emerald-500 text-emerald-500' : 'bg-amber-500 text-amber-500'}`}></div>
          <span className="text-zinc-500 font-mono">{engineStatus}</span>
        </div>
        <div className="text-zinc-600 font-medium tracking-wide">
          Desarrollado por <span className="text-violet-400/80 font-semibold">XChris-Z</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
