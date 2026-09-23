export const imageMimeTypes = {
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.jfif': 'image/jfif',
} as const;
export type ImageMime = typeof imageMimeTypes[keyof typeof imageMimeTypes];
export interface ExportSettings {
  scale: number;
  dpi: number;
  embedScene: boolean;
  background: boolean;
}
export const defaultExportSettings: ExportSettings = { scale: 2, dpi: 300, embedScene: true, background: true };
export function validateExportSettings(value: unknown): asserts value is ExportSettings {
  const settings = value as ExportSettings;
  if (!settings || ![1, 2, 3, 4, 6, 8].includes(settings.scale) || !Number.isInteger(settings.dpi) ||
      settings.dpi < 36 || settings.dpi > 2400 || typeof settings.embedScene !== 'boolean' || typeof settings.background !== 'boolean') {
    throw new Error('导出设置无效：倍率应为 1/2/3/4/6/8，DPI 应为 36–2400 的整数。');
  }
}
