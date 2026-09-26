import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { 
  Download, Settings, ClipboardPaste, 
  CheckCircle2, Folder, Film, MonitorPlay, 
  Video, Music, HardDrive, Clock, Globe
} from "lucide-react";

function App() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("video");
  const [quality, setQuality] = useState("1080p");
  const [browser, setBrowser] = useState("firefox");
  const [destFolder, setDestFolder] = useState("C:\\Users\\Downloads\\VideoPlus");
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ size: "0 MB", speed: "0 MB/s", eta: "--:--" });
  const [engineStatus, setEngineStatus] = useState("Verificando motores...");
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    // Escuchar progreso del motor
    const unlistenEngine = listen<any>("engine-download-progress", (event) => {
      setEngineStatus(`Descargando ${event.payload.engine}... ${event.payload.progress.toFixed(1)}%`);
    });

    // Escuchar progreso del video
    const unlistenVideo = listen<any>("download-progress", (event) => {
      const p = event.payload;
      setProgress(p.percent);
      setStats({ size: p.size, speed: p.speed, eta: p.eta });
      if (p.percent === 100) {
        setDownloading(false);
        saveToHistory();
      }
    });

    // Iniciar verificación
    invoke("check_and_download_engines").then(() => {
      setEngineStatus("Motor: yt-dlp Listo");
    }).catch(err => {
      setEngineStatus(`Error: ${err}`);
    });

    // Cargar historial
    invoke("get_history").then((res: any) => {
      try { setHistory(JSON.parse(res)); } catch(e) {}
    });

    return () => {
      unlistenEngine.then(f => f());
      unlistenVideo.then(f => f());
    }
  }, []);

  const saveToHistory = async () => {
    const newEntry = { url, format, quality, date: new Date().toISOString() };
    const newHistory = [...history, newEntry];
    setHistory(newHistory);
    await invoke("save_history", { historyJson: JSON.stringify(newHistory) });
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch (err) {
      console.error("Failed to read clipboard contents: ", err);
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
    setProgress(0);
    setStats({ size: "Calculando...", speed: "-", eta: "--:--" });

    try {
      await invoke("start_download", {
        url,
        format,
        quality,
        destFolder,
        playlist: false, // O el estado real
        browser
      });
    } catch (error) {
      console.error(error);
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col font-sans select-none">
      {/* Header (Draggable for Tauri) */}
      <div data-tauri-drag-region className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 sticky top-0 z-50">
        <div className="flex items-center gap-2 pointer-events-none">
          <div className="w-2.5 h-2.5 rounded-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.8)]"></div>
          <h1 className="font-semibold tracking-wide text-xs text-zinc-300 uppercase">Universal Video Downloader - Motor yt-dlp</h1>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 max-w-4xl mx-auto w-full">
        
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
          <button className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg border border-zinc-700 transition-colors font-medium text-sm shadow-sm">
            Ver Historial
          </button>
        </div>

        {/* URL Input Section */}
        <section className="bg-zinc-900 p-1 rounded-xl border border-zinc-800 flex items-center shadow-lg focus-within:border-violet-500/50 transition-colors">
          <div className="px-4 text-zinc-500">
            <Film size={20} />
          </div>
          <input 
            type="text" 
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Pega la URL del video aquí (YouTube, TikTok, Twitter...)" 
            className="flex-1 bg-transparent border-none outline-none text-zinc-100 placeholder:text-zinc-600 py-4"
          />
          {url && (
            <div className="px-3 flex items-center gap-1 text-xs font-medium text-emerald-500 bg-emerald-500/10 rounded-full py-1 mr-3">
              <CheckCircle2 size={14} /> Listo
            </div>
          )}
          <button 
            onClick={handlePaste}
            className="flex items-center gap-2 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg mr-1 transition-colors font-medium text-sm"
          >
            <ClipboardPaste size={16} /> Pegar
          </button>
        </section>

        {/* Layout Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          
          {/* Preview Card */}
          <section className="md:col-span-5 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col shadow-lg relative group">
            <div className="aspect-video bg-zinc-950 flex items-center justify-center relative overflow-hidden">
              <MonitorPlay size={48} className="text-zinc-800" />
              {/* Overlay on hover or when image is present */}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 to-transparent opacity-60"></div>
              <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded text-xs text-zinc-300 font-mono flex items-center gap-1 border border-zinc-800">
                <Clock size={12} /> --:--
              </div>
            </div>
            <div className="p-4 flex-1 flex flex-col gap-1">
              <h3 className="font-semibold text-zinc-200 line-clamp-2 leading-tight">Esperando video...</h3>
              <p className="text-sm text-zinc-500 mt-1">Autor / Canal</p>
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
          {downloading && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }} 
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-3 bg-zinc-900 p-5 rounded-xl border border-zinc-800 shadow-lg"
            >
              <div className="flex justify-between items-end">
                <div className="flex flex-col">
                  <span className="text-xs font-mono text-cyan-500 mb-1">Descargando...</span>
                  <span className="font-semibold text-zinc-200">Video_Tutorial_2026.mp4</span>
                </div>
                <span className="text-2xl font-bold text-zinc-100 font-mono">{progress}%</span>
              </div>
              
              <div className="h-1.5 w-full bg-zinc-950 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)]"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="flex justify-between text-xs text-zinc-400 font-mono mt-1">
                <span className="flex items-center gap-1"><HardDrive size={12}/> {stats.size}</span>
                <span className="text-emerald-500">{stats.speed}</span>
                <span>ETA: {stats.eta}</span>
              </div>
            </motion.div>
          )}

          <button 
            onClick={handleDownload}
            disabled={downloading}
            className={`w-full py-5 rounded-xl font-bold text-lg tracking-wide flex items-center justify-center gap-3 transition-all ${
              downloading 
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
              : 'bg-violet-600 hover:bg-violet-700 text-white shadow-[0_0_20px_rgba(124,58,237,0.3)] hover:shadow-[0_0_30px_rgba(124,58,237,0.5)] active:scale-[0.99]'
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
