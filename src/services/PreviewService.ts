import type { Scene } from '../document';
import type { ExcalidrawElement, NonDeleted } from '@excalidraw/excalidraw/element/types';

type Preview = { src: string; warning?: string };
const pending = new Map<string, { key: string; promise: Promise<Preview> }>();
let renderQueue: Promise<unknown> = Promise.resolve();
const exportOptions = { exportPadding: 24, maxWidthOrHeight: 640 };
const exportState = { exportBackground: true, exportWithDarkMode: false, exportScale: 1 };

export async function loadPreview(id: string, scene: Scene): Promise<Preview> {
  // Hash actual rendering inputs once per visible scene, not just element version
  // counters. A filename change is deliberately absent. Never trust legacy SVGs.
  const input = JSON.stringify({
    renderer: 'excalidraw-0.18.1-canvas-v1',
    exportOptions, exportState,
    elements: scene.elements.filter(element => !element.isDeleted),
    background: scene.appState.viewBackgroundColor ?? '#ffffff',
    files: Object.fromEntries(Object.entries(scene.files).sort(([a], [b]) => a.localeCompare(b))
      .map(([id, file]) => [id, { mimeType: file.mimeType, dataURL: file.dataURL }])),
  });
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const key = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const existing = pending.get(id);
  if (existing?.key === key) return existing.promise;
  const promise = (async () => {
    let warning: string | undefined;
    try {
      const cached = await window.desktop.getThumbnail(id, key);
      if (cached) return { src: cached };
    } catch { warning = '预览缓存无法读取；绘图数据未受影响。'; }
    // Serialize expensive renders, not document writes. The official exporter
    // loads scene fonts and images before using Excalidraw's actual scene renderer.
    const render = renderQueue.then(async () => {
      const { exportToCanvas } = await import('@excalidraw/excalidraw');
      const canvas = await exportToCanvas({
        elements: scene.elements.filter((element): element is NonDeleted<ExcalidrawElement> => !element.isDeleted),
        appState: { viewBackgroundColor: scene.appState.viewBackgroundColor ?? '#ffffff', ...exportState },
        files: scene.files,
        ...exportOptions,
      });
      const src = canvas.toDataURL('image/png');
      canvas.width = canvas.height = 0;
      try { await window.desktop.putThumbnail(id, key, src); }
      catch { warning = '预览已显示，但缓存未写入；绘图数据未受影响。'; }
      return { src, warning };
    });
    renderQueue = render.catch(() => undefined);
    return render;
  })();
  pending.set(id, { key, promise });
  void promise.catch(() => { if (pending.get(id)?.promise === promise) pending.delete(id); });
  return promise;
}
