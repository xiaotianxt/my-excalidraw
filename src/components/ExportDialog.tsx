import { useEffect, useState } from 'react';
import type { Scene } from '../document';
import { defaultExportSettings, validateExportSettings, type ExportSettings } from '../image-format';
import { DecisionDialog } from './DecisionDialog';

export function ExportDialog({ name, scene, onClose, onExported }: { name: string; scene: Scene | null; onClose: () => void; onExported: (path: string) => void }) {
  const [settings, setSettings] = useState<ExportSettings>({ ...defaultExportSettings });
  const [format, setFormat] = useState<'png' | 'svg'>('png');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    void window.desktop.getExportSettings().then(value => { if (!cancelled) setSettings(value); })
      .catch(error => { if (!cancelled) setError(`读取默认设置失败，当前使用临时默认值。${String(error)}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const saveDefaults = async () => {
    setBusy(true); setError(''); setNotice('');
    try { validateExportSettings(settings); await window.desktop.saveExportSettings(settings); setNotice('默认导出设置已保存。'); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const exportImage = async () => {
    if (!scene) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { renderImage } = await import('../services/ImageService');
      const bytes = await renderImage(scene, format, settings);
      const result = await window.desktop.exportImage(name, format, bytes, settings.dpi);
      if (result) { onExported(result.filePath); onClose(); }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <DecisionDialog title={scene ? '导出图像' : '默认导出设置'} onCancel={() => { if (!busy) onClose(); }}>
    <div className="export-options">
      {scene && <label>格式<select value={format} disabled={busy || loading} onChange={event => setFormat(event.target.value as 'png' | 'svg')}><option value="png">PNG · 位图</option><option value="svg">SVG · 矢量图</option></select></label>}
      <div className="export-resolution">
        <label>PNG 导出倍率<select value={settings.scale} disabled={busy || loading || format === 'svg'} onChange={event => setSettings({ ...settings, scale: Number(event.target.value) })}>{[1, 2, 3, 4, 6, 8].map(scale => <option key={scale} value={scale}>{scale}×</option>)}</select></label>
        <label>PNG 打印 DPI<input type="number" min={36} max={2400} step={1} value={settings.dpi} disabled={busy || loading || format === 'svg'} onChange={event => setSettings({ ...settings, dpi: Number(event.target.value) })} /></label>
      </div>
      <p className="export-explanation">{format === 'svg' ? 'SVG 保持矢量，不使用 PNG 的倍率和 DPI；内嵌的照片仍受原图片分辨率限制。' : '倍率增加像素数量；DPI 仅标记打印尺寸，不会凭空增加细节。'}</p>
      <label className="export-checkbox"><input type="checkbox" checked={settings.embedScene} disabled={busy || loading} onChange={event => setSettings({ ...settings, embedScene: event.target.checked })} />嵌入 Excalidraw 场景，可重新打开编辑</label>
      <p className="export-explanation">嵌入会包含完整可编辑图形和使用的图片，文件也会更大。关闭后仅保留图像外观。</p>
      <label className="export-checkbox"><input type="checkbox" checked={settings.background} disabled={busy || loading} onChange={event => setSettings({ ...settings, background: event.target.checked })} />包含画布背景</label>
      {scene && <p className="export-explanation">导出是独立副本，不会提交草稿或改动原绘图文件。</p>}
    </div>
    {loading && <p role="status">正在读取默认设置…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button disabled={busy} onClick={onClose}>取消</button><button disabled={busy || loading} onClick={() => void saveDefaults()}>保存为默认</button>{scene && <button className="primary" disabled={busy || loading} onClick={() => void exportImage()}>{busy ? '正在处理…' : `导出 ${format.toUpperCase()}…`}</button>}</div>
  </DecisionDialog>;
}
