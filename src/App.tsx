import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { open } from "@tauri-apps/plugin-dialog";
import { 
  Download, Settings, ClipboardPaste, 
  CheckCircle2, Folder, Film, MonitorPlay, 
  Video, Music, HardDrive, Clock, Globe, X, AlertCircle
} from "lucide-react";
import { downloadDir } from '@tauri-apps/api/path';

function App() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState(() => localStorage.getItem('vplus_format') || "video");
  const [quality, setQuality] = useState(() => localStorage.getItem('vplus_quality') || "1080p");
  const [browser, setBrowser] = useState(() => localStorage.getItem('vplus_browser') || "firefox");
  const [destFolder, setDestFolder] = useState(() => localStorage.getItem('vplus_destFolder') || "");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [infoError, setInfoError] = useState("");
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ size: "0 MB", speed: "0 MB/s", eta: "--:--", status: "" });
  const [engineStatus, setEngineStatus] = useState("Verificando motores...");
  const [history, setHistory] = useState<any[]>([]);

  const [videoInfo, setVideoInfo] = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updatingEngines, setUpdatingEngines] = useState(false);

  useEffect(() => {
    // Escuchar progreso de descarga de motores
    const unlistenEngine = listen<any>("engine-download-progress", (event) => {
      setEngineStatus(`Actualizando yt-dlp... ${event.payload.progress.toFixed(1)}%`);
    });

    // Escuchar progreso del video
    const unlistenVideo = listen<any>("download-progress", (event) => {
      const p = event.payload;
      setProgress(p.percent);
      setStats({ size: p.size, speed: p.speed, eta: p.eta, status: p.status });
      if (p.percent === 100) {
        setDownloading(false);
        saveToHistory();
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
      try { setHistory(JSON.parse(res)); } catch(e) {}
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
      const update = await check();
      if (update) {
        setEngineStatus(`Descargando actualización v${update.version}...`);
        await update.downloadAndInstall();
        setEngineStatus("Actualización instalada. Reiniciando...");
        await relaunch();
      } else {
        setEngineStatus("Ya tienes la última versión ✅");
      }
    } catch (e) {
      console.error(e);
      setEngineStatus("Aún no hay versiones publicadas en GitHub.");
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
    const newEntry = { url, format, quality, date: new Date().toISOString(), title: videoInfo?.title || url };
    const newHistory = [...history, newEntry];
    setHistory(newHistory);
    await invoke("save_history", { historyJson: JSON.stringify(newHistory) });
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

  useEffect(() => {
    if (url && url.startsWith("http")) {
      fetchVideoInfo(url, browser);
    }
  }, [browser]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      fetchVideoInfo(text, browser);
    } catch (err) {
      console.error("Failed to read clipboard contents: ", err);
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
    setDownloading(true);
    setDownloadError("");
    setProgress(0);
    setStats({ size: "Calculando...", speed: "-", eta: "--:--", status: "Iniciando..." });

    try {
      await invoke("start_download", {
        url,
        format,
        quality,
        destFolder,
        playlist: false, // O el estado real
        browser
      });
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
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col font-sans select-none relative">
      {/* History Modal */}
      {showHistory && (
        <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
              <h2 className="font-semibold text-lg flex items-center gap-2"><Clock size={18}/> Historial de Descargas</h2>
              <button onClick={() => setShowHistory(false)} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800">
                Cerrar
              </button>
            </div>
            <div className="overflow-y-auto p-4 flex-1">
              {history.length === 0 ? (
                <p className="text-zinc-500 text-center py-8">No hay descargas recientes.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {[...history].reverse().map((item, i) => (
                    <div key={i} className="flex flex-col gap-1 p-3 bg-zinc-950 rounded-lg border border-zinc-800/50">
                      <h4 className="font-medium text-sm text-zinc-200 line-clamp-1">{item.title}</h4>
                      <div className="flex items-center gap-3 text-xs text-zinc-500">
                        <span className="text-violet-400">{item.format.toUpperCase()}</span>
                        <span>{item.quality}</span>
                        <span>{new Date(item.date).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header (Draggable for Tauri) */}
      <div data-tauri-drag-region className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 sticky top-0 z-50">
        <div className="flex items-center gap-2 pointer-events-none">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
          <h1 className="font-semibold tracking-wide text-xs text-zinc-300 uppercase">{engineStatus}</h1>
        </div>
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
              <button onClick={handleUpdateEngines} disabled={updatingEngines} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors text-xs shadow-sm disabled:opacity-50 border border-zinc-700">
                {updatingEngines ? "Actualizando..." : "Actualizar Motor"}
              </button>
              <button onClick={handleUpdateApp} disabled={updatingApp} className="flex items-center gap-2 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/40 text-violet-300 border border-violet-500/30 rounded-md transition-colors text-xs shadow-sm disabled:opacity-50">
                {updatingApp ? "Buscando..." : "Actualizar App"}
              </button>
            </div>
            <button onClick={() => setShowHistory(true)} className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg border border-zinc-700 transition-colors font-medium text-sm shadow-sm w-full justify-center">
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
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800/50 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg mr-2 transition-colors font-medium text-sm"
          >
            <X size={16} /> Limpiar
          </button>
          <button 
            onClick={handlePaste}
            className="flex items-center gap-2 px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg mr-1 transition-colors font-medium text-sm"
          >
            <ClipboardPaste size={16} /> Pegar
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
                  className="p-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-zinc-700 transition-colors text-zinc-300"
                  title="Seleccionar carpeta"
                >
                  <Folder size={18} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-1">
              <div className="flex items-center gap-3 bg-zinc-950/50 p-3 rounded-lg border border-zinc-800/50">
                <input type="checkbox" id="playlist" className="w-4 h-4 accent-violet-600 bg-zinc-900 border-zinc-700 rounded" />
                <label htmlFor="playlist" className="text-sm text-zinc-300 select-none cursor-pointer">Descargar Playlist completa</label>
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
          {(downloading || progress > 0 || downloadError) && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }} 
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-3 bg-zinc-900 p-5 rounded-xl border border-zinc-800 shadow-lg"
            >
              {downloadError ? (
                <div className="text-red-400 text-sm p-2 bg-red-500/10 rounded border border-red-500/20 flex flex-col gap-1 max-h-32 overflow-y-auto">
                  <span className="font-bold flex items-center gap-1"><AlertCircle size={16}/> Error en la descarga</span>
                  <span className="font-mono text-xs opacity-80">{downloadError}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-end">
                    <div className="flex flex-col gap-1 overflow-hidden pr-4">
                      <span className="text-xs font-mono text-zinc-500 mb-1">{stats.status || "Descargando..."}</span>
                      <span className="font-semibold text-zinc-200 line-clamp-1 truncate">{videoInfo?.title || url}</span>
                    </div>
                    <span className="text-2xl font-bold text-zinc-100 font-mono">{progress}%</span>
                  </div>
                  
                  <div className="h-1.5 w-full bg-zinc-950 rounded-full overflow-hidden">
                    <motion.div 
                      className={`h-full ${progress === 100 ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : getPlatformProgressColor()}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-xs text-zinc-400 font-mono mt-1">
                    <span className="flex items-center gap-1"><HardDrive size={12}/> {stats.size}</span>
                    <span className="text-emerald-500">{stats.speed}</span>
                    <span>ETA: {stats.eta}</span>
                  </div>
                </>
              )}
            </motion.div>
          )}

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
