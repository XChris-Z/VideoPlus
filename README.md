# 🚀 Universal Video Downloader

![Tauri](https://img.shields.io/badge/Tauri-v2.0-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-18.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-Backend-000000?style=for-the-badge&logo=rust&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)

Una aplicación de escritorio moderna, ultrarrápida y ligera para descargar videos y audios desde múltiples plataformas (YouTube, TikTok, Twitter, etc.). Desarrollada con **Rust**, **Tauri v2** y **React**.

---

## ✨ Características Principales

- 🎨 **Diseño Premium Synthwave/Tech:** Interfaz de usuario moderna con Dark Mode (`zinc-950`), acentos en `violet-600` y progreso en `cyan-500` brillante, animada con Framer Motion.
- ⚡ **Rendimiento Nativo:** Construida sobre Tauri y Rust, consumiendo apenas una fracción de la memoria RAM comparado con aplicaciones basadas en Electron.
- 🤖 **Auto-instalación de Motores:** La aplicación detecta y descarga automáticamente las dependencias en segundo plano (`yt-dlp` y `ffmpeg`) si no están instaladas en tu sistema.
- 📺 **Soporte Universal:** Extrae videos y audios de cientos de sitios gracias a la robustez de `yt-dlp`.
- 🔁 **Streaming de Progreso en Tiempo Real:** El backend en Rust se comunica con el frontend en React emitiendo eventos de progreso exactos (porcentaje, ETA, velocidad, tamaño).
- 🍪 **Cookies desde Navegador:** Capacidad de extraer *cookies* directamente de tu navegador favorito (Firefox, Chrome, Edge) para descargar contenido restringido por edad o privado.
- 🔄 **Auto-Actualización Integrada:** Incluye configuración de Auto-Updater (Tauri) preparado para conectarse a GitHub Releases.

---

## 🛠️ Stack Tecnológico

- **Core & Backend:** Rust + Tauri v2
- **Frontend:** React + TypeScript + Vite
- **Estilos:** Tailwind CSS + Lucide React + Framer Motion
- **Motores Externos:** `yt-dlp` y `ffmpeg`

---

## 🚀 Guía de Instalación y Desarrollo

### Requisitos Previos

Asegúrate de tener instalados los siguientes componentes en tu sistema:
1. **Node.js** (v16+)
2. **Rust y Cargo** ([Instalar Rust](https://www.rust-lang.org/tools/install))
3. Herramientas de compilación de C++ (En Windows, instala "Desktop development with C++" a través del Visual Studio Installer).


### 1. Instalar dependencias del Frontend
```bash
npm install
```

### 2. Modo Desarrollo
Para ejecutar la aplicación en entorno de desarrollo (con *Hot-Reload*):
```bash
npm run tauri dev
```
*(Nota: La primera vez tomará algo de tiempo mientras Cargo compila el backend en Rust).*

### 3. Compilar para Producción (Crear Instalador)
Para construir el instalador final `.nsis` optimizado:
```bash
npm run tauri build
```
Encontrarás el instalador generado en la carpeta: `src-tauri/target/release/bundle/nsis/`.

---

## 📁 Estructura del Proyecto

```text
├── src/                  # Frontend en React (App.tsx, index.css)
├── src-tauri/            # Backend en Rust
│   ├── src/lib.rs        # Lógica de descarga, eventos y auto-instalador yt-dlp
│   ├── src/main.rs       # Punto de entrada de Tauri
│   ├── tauri.conf.json   # Configuración de compilación, permisos y updater
│   └── Cargo.toml        # Dependencias de Rust (tokio, reqwest, etc.)
├── tailwind.config.js    # Configuración de estilos y paleta de colores
└── package.json          # Scripts y dependencias de NPM
```

---

## ✍️ Desarrollado por
**XChris-Z**

*Si el proyecto te fue útil, ¡no olvides darle una ⭐ al repositorio!*
