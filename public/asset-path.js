// Excalidraw registers fonts at module evaluation time. Set this before loading
// any application modules, including chunks shared with the lazy editor.
window.EXCALIDRAW_ASSET_PATH = new URL('./excalidraw-assets/', document.currentScript.src).href;
