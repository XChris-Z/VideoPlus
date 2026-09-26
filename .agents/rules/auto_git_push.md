# Auto Git Push on Updates

Siempre que completes cambios en el código, corrijas errores o implementes nuevas funcionalidades en un proyecto, DEBES hacer commit y subir los cambios automáticamente al repositorio de Git activo utilizando el siguiente flujo de trabajo:

1. **Preparar cambios:** Ejecuta `git add .`
2. **Crear el commit:** Usa un mensaje de commit "genial" y altamente técnico siguiendo la convención de Conventional Commits (ej. `feat:`, `fix:`, `refactor:`). Incluye un emoji relevante al inicio del mensaje.
   - Ejemplo: `git commit -m "✨ feat(ui): implementar selector de directorios nativo mediante tauri-plugin-dialog"`
   - Ejemplo: `git commit -m "♻️ refactor(backend): optimizar parser de stdout asíncrono para yt-dlp"`
3. **Subir los cambios:** Ejecuta `git push`

Ejecuta este flujo automáticamente al final de tu trabajo en lugar de esperar a que el usuario te lo pida explícitamente.
