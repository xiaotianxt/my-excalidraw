import { useEffect, useRef, useState } from 'react';
import { fingerprint, type Scene } from '../document';
import { loadPreview } from '../services/PreviewService';

export function DocumentPreview({ id, scene }: { id: string; scene: Scene }) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<string>();
  const [warning, setWarning] = useState('');
  const signature = fingerprint(scene);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const empty = !scene.elements.some(element => !element.isDeleted);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '100px' });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSource(undefined);
    setWarning('');
    if (!visible || empty) return;
    let cancelled = false;
    void loadPreview(id, sceneRef.current).then(result => {
      if (!cancelled) { setSource(result.src); setWarning(result.warning ?? ''); }
    }).catch(() => { if (!cancelled) setWarning('预览暂不可用；仍可打开绘图。'); });
    return () => { cancelled = true; };
  }, [id, signature, visible, empty]);

  return <span ref={host} className="document-preview" title={warning || undefined}>
    {source ? <img src={source} alt="" loading="lazy" decoding="async" onError={() => { setSource(undefined); setWarning('预览暂不可用；仍可打开绘图。'); }} />
      : <span className="preview-placeholder">{empty ? '空白画布' : warning ? '预览暂不可用' : '正在准备预览…'}</span>}
    {warning && source && <span className="preview-warning" aria-label={warning}>!</span>}
  </span>;
}
