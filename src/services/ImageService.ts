import type { BinaryFileData } from '@excalidraw/excalidraw/types';
import type { FileId, NonDeleted, ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { sceneData, type Scene } from '../document';
import { validateExportSettings, type ExportSettings, type ImageMime } from '../image-format';

function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const { naturalWidth: width, naturalHeight: height } = image;
      if (!width || !height || width > 16384 || height > 16384 || width * height > 32_000_000) reject(new Error('图片尺寸过大或无效（最多 3200 万像素，边长不超过 16384）。'));
      else resolve({ width, height });
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法解码这张图片。文件可能损坏或格式不受支持。')); };
    image.src = url;
  });
}

function dataURL(blob: Blob): Promise<BinaryFileData['dataURL']> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as BinaryFileData['dataURL']);
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.readAsDataURL(blob);
  });
}

export async function importImage(bytes: Uint8Array, mimeType: ImageMime): Promise<{ data: Scene; embedded: boolean }> {
  const blob = new Blob([new Uint8Array(bytes).buffer], { type: mimeType });
  const { loadFromBlob, convertToExcalidrawElements } = await import('@excalidraw/excalidraw');
  if (mimeType === 'image/png' || mimeType === 'image/svg+xml') {
    try {
      const restored = await loadFromBlob(blob, null, null);
      return { data: sceneData(restored.elements, restored.appState, restored.files ?? {}), embedded: true };
    } catch (error) {
      // Only absence of a scene permits flattening. Corrupt embedded scene data
      // must be reported, not silently replaced with a non-editable image.
      if (!(error instanceof Error && 'code' in error && error.code === 'IMAGE_NOT_CONTAINS_SCENE_DATA')) {
        throw new Error('图片中的 Excalidraw 场景无法恢复。未将它降级成普通图片，原文件未改动。');
      }
    }
  }
  const { width, height } = await imageSize(blob);
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  const id = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('') as FileId;
  const file: BinaryFileData = { id, mimeType, dataURL: await dataURL(blob), created: Date.now() };
  const elements = convertToExcalidrawElements([{ type: 'image', x: 0, y: 0, width, height, fileId: id, status: 'saved', scale: [1, 1] }]);
  return { data: sceneData(elements, {}, { [id]: file }), embedded: false };
}

export async function renderImage(scene: Scene, format: 'png' | 'svg', settings: ExportSettings): Promise<Uint8Array> {
  validateExportSettings(settings);
  const { exportToBlob, exportToSvg } = await import('@excalidraw/excalidraw');
  const elements = scene.elements.filter((element): element is NonDeleted<ExcalidrawElement> => !element.isDeleted);
  if (!elements.length) throw new Error('画布为空，请先添加内容。');
  const options = {
    elements, files: scene.files, exportPadding: 24,
    appState: { ...scene.appState, exportEmbedScene: settings.embedScene, exportBackground: settings.background, exportWithDarkMode: false, exportScale: format === 'png' ? settings.scale : 1 },
  };
  if (format === 'svg') {
    const svg = await exportToSvg(options);
    return new TextEncoder().encode(new XMLSerializer().serializeToString(svg));
  }
  const blob = await exportToBlob({ ...options, mimeType: 'image/png', getDimensions: (width: number, height: number) => {
    const outputWidth = Math.ceil(width * settings.scale);
    const outputHeight = Math.ceil(height * settings.scale);
    if (outputWidth > 16384 || outputHeight > 16384 || outputWidth * outputHeight > 32_000_000) {
      throw new Error('该倍率超过安全导出尺寸（3200 万像素 / 边长 16384）。请降低倍率，或导出无损缩放的 SVG。');
    }
    return { width: outputWidth, height: outputHeight, scale: settings.scale };
  } });
  return new Uint8Array(await blob.arrayBuffer());
}
