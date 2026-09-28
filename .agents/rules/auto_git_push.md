# Auto Git Push & Release Protocol

Siempre que completes cambios en el código, corrijas errores o implementes nuevas funcionalidades en el proyecto, DEBES hacer commit, etiquetar y subir los cambios automáticamente al repositorio de Git activo siguiendo este flujo de trabajo estricto:

1. **Sincronización de Versión y Firmas:**
   - Asegurar que `createUpdaterArtifacts: true` se mantenga activo en `bundle` en `src-tauri/tauri.conf.json` para que cada compilación en GitHub genere `latest.json` y la firma criptográfica `.sig`.
   - Incrementar la versión (`patch` o `minor`) sincronizadamente en:
     - `package.json`
     - `src-tauri/tauri.conf.json`
     - Modal de Información en `src/App.tsx`
   - Verificar que los permisos requeridos (como `clipboard-manager:default`, `updater:default`) sigan presentes en `src-tauri/capabilities/default.json`.

2. **Preparar cambios:**
   - Ejecutar `git add .`

3. **Crear el commit:**
   - Usar un mensaje técnico y descriptivo siguiendo Conventional Commits con un emoji relevante al inicio.
   - Ejemplo: `git commit -m "✨ feat(updater): sincronizar version v1.0.12 con soporte de firmas y latest.json"`

4. **Crear etiqueta de versión (Git Tag):**
   - Crear el tag correspondiente para disparar la compilación automática en GitHub Actions:
     `git tag -a vX.X.X -m "VideoPlus vX.X.X"`

5. **Subir los cambios y las etiquetas:**
   - Ejecutar: `git push origin main --tags`

Ejecuta este flujo automáticamente al final de cada trabajo para garantizar que todas las versiones estén siempre compiladas, firmadas y listas para auto-actualización en GitHub Releases.
