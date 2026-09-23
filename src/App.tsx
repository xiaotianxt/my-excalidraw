import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { emptyScene, fingerprint, isDirty, sceneData, type Draft, type OpenDocument, type Scene } from './document';
import { workspaceService, type WorkspaceFile } from './services/WorkspaceService';
import { WorkspacePage } from './components/WorkspacePage';
import { DecisionDialog } from './components/DecisionDialog';
import { EditorBoundary } from './components/EditorBoundary';
import { ExportDialog } from './components/ExportDialog';
import './App.css';

type Problem = { title: string; message: string; retry: () => void; canSave: boolean };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const draftKey = (document: Draft) => JSON.stringify([document.name, document.committedFingerprint, fingerprint(document.data)]);

const Editor = lazy(() => import('./components/Editor'));

export default function App() {
  const [document, setDocument] = useState<OpenDocument | null>(null);
  const current = useRef<OpenDocument | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [draftStatus, setDraftStatus] = useState<'pending' | 'writing' | 'saved' | 'failed'>('pending');
  const [draftError, setDraftError] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [clearDialog, setClearDialog] = useState(false);
  const [discardDialog, setDiscardDialog] = useState(false);
  const [renameDialog, setRenameDialog] = useState<{ id: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState('');
  const [exportDialog, setExportDialog] = useState<'image' | 'settings' | null>(null);
  const [notice, setNotice] = useState('');
  const [beforeClear, setBeforeClear] = useState<Scene | null>(null);
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const canvasContainer = useRef<HTMLElement | null>(null);
  const setEditorAPI = useCallback((value: ExcalidrawImperativeAPI) => { api.current = value; }, []);
  const requestExport = useCallback(() => {
    if (current.current?.data.elements.some(element => !element.isDeleted)) setExportDialog('image');
  }, []);
  const requestClear = useCallback(() => {
    if (current.current?.data.elements.some(element => !element.isDeleted)) setClearDialog(true);
  }, []);
  const durable = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pendingSince = useRef<number | null>(null);
  const writeTail = useRef<Promise<unknown>>(Promise.resolve());

  const update = useCallback((value: OpenDocument | null) => { current.current = value; setDocument(value); }, []);
  const stopTimer = useCallback(() => { clearTimeout(timer.current); pendingSince.current = null; }, []);
  const lock = () => { if (busyRef.current) return false; busyRef.current = true; if (canvasContainer.current) canvasContainer.current.inert = true; setBusy(true); stopTimer(); return true; };
  const unlock = () => { busyRef.current = false; if (canvasContainer.current) canvasContainer.current.inert = false; setBusy(false); };

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [saved, recovered] = await Promise.all([workspaceService.getAllFiles(), window.desktop.listDrafts()]);
      setFiles(saved);
      // A crash after committing but before removing a draft must not resurrect
      // an old "unsaved" state. Reads never delete or rewrite recovery data.
      setDrafts(recovered.filter(draft => {
        const file = saved.find(item => item.id === draft.id);
        return !file || fingerprint(file.data) !== fingerprint(draft.data) || file.name !== draft.name;
      }));
      for (const draft of recovered) durable.current.set(draft.id, draftKey(draft));
    } catch (error) { setLoadError(message(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const persist = useCallback((snapshot: OpenDocument): Promise<void> => {
    const run = writeTail.current.catch(() => undefined).then(async () => {
      const key = draftKey(snapshot);
      if (durable.current.get(snapshot.id) === key) return;
      setDraftStatus('writing');
      await window.desktop.writeDraft(snapshot);
      durable.current.set(snapshot.id, key);
      if (current.current?.id === snapshot.id && draftKey(current.current) === key) {
        setDraftStatus('saved'); setDraftError('');
      }
    });
    writeTail.current = run;
    return run;
  }, []);

  const flush = useCallback(async () => {
    stopTimer();
    const snapshot = current.current;
    if (snapshot && isDirty(snapshot)) await persist(snapshot);
    else await writeTail.current.catch(() => undefined);
  }, [persist, stopTimer]);

  useEffect(() => {
    if (!document || !isDirty(document) || busy) return;
    if (durable.current.get(document.id) === draftKey(document)) { setDraftStatus('saved'); return; }
    setDraftStatus('pending');
    pendingSince.current ??= Date.now();
    // Debounce with a maximum delay so continuous drawing still gets recovered.
    timer.current = setTimeout(() => {
      pendingSince.current = null;
      const snapshot = current.current;
      if (snapshot) void persist(snapshot).catch(error => { setDraftStatus('failed'); setDraftError(message(error)); });
    }, Math.min(800, Math.max(0, 5000 - (Date.now() - pendingSince.current))));
    return () => clearTimeout(timer.current);
  }, [document, busy, persist]);

  const activate = (value: OpenDocument) => {
    api.current = null; setBeforeClear(null); setDraftError(''); setProblem(null); setNotice('');
    setDraftStatus(durable.current.get(value.id) === draftKey(value) ? 'saved' : 'pending');
    update(value);
  };
  const create = () => activate({ id: crypto.randomUUID(), name: '未命名绘图', data: emptyScene(), updatedAt: Date.now(), committedFingerprint: null });

  const openSaved = async (file: WorkspaceFile) => {
    if (!lock()) return;
    const cached = sceneData(file.data.elements, file.data.appState, file.data.files);
    const value = { id: file.id, name: file.name, data: cached, filePath: file.filePath, updatedAt: file.updatedAt, committedFingerprint: fingerprint(cached) };
    try {
      const latest = await window.desktop.loadFile(file.id);
      const data = latest ? sceneData(latest.data.elements, latest.data.appState, latest.data.files) : cached;
      activate({ ...value, data, filePath: latest?.filePath ?? file.filePath, committedFingerprint: fingerprint(data) });
    } catch (error) {
      activate(value);
      setProblem({ title: '原文件未能读取，已打开工作区副本', message: `这可能不是磁盘上的最新版本。可另存副本保护内容，不会自动覆盖原文件。${message(error)}`, retry: () => { void openSaved(file); }, canSave: true });
    } finally { unlock(); }
  };

  const navigate = async (destination: 'workspace' | 'close' | 'new' | 'open') => {
    if (!lock()) return;
    try {
      await flush();
      if (destination === 'close') { window.desktop.closeWindow(); return; }
      if (destination === 'new') create();
      else if (destination === 'open') {
        const id = crypto.randomUUID();
        const result = await window.desktop.openFile(id);
        if (result) {
          const name = result.filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '绘图';
          if (result.kind === 'image') {
            const { importImage } = await import('./services/ImageService');
            const imported = await importImage(result.bytes, result.mimeType);
            const value = { id, name, data: imported.data, updatedAt: Date.now(), committedFingerprint: null };
            await persist(value);
            activate(value);
            setNotice(imported.embedded ? '已恢复图片中的可编辑场景。保存绘图或导出新图片时另选位置，不自动覆盖来源图片。' : '已作为图片导入画布（动图使用静态画面）。来源图片不变；保存可编辑图片请使用「导出图像」。');
          } else {
            // Index an existing scene without rewriting its source file.
            const data = sceneData(result.data.elements, result.data.appState, result.data.files);
            await workspaceService.saveToWorkspace(name, data.elements, data.appState, data.files, id, result.filePath);
            activate({ id, name, data, filePath: result.filePath, updatedAt: Date.now(), committedFingerprint: fingerprint(data) });
          }
        }
      } else { update(null); api.current = null; await reload(); }
      setProblem(null);
    } catch (error) {
      if (destination === 'close') window.desktop.cancelClose();
      setProblem({ title: '尚未安全离开', message: `操作未完成，当前画布仍保留在窗口中。${message(error)}`, retry: () => { void navigate(destination); }, canSave: !!current.current });
    } finally { unlock(); }
  };

  const settleDraft = async (snapshot: OpenDocument) => {
    await writeTail.current.catch(() => undefined);
    await persist(snapshot);
    if (!isDirty(snapshot)) {
      await window.desktop.deleteDraft(snapshot.id);
      durable.current.delete(snapshot.id);
    }
  };

  const retryCleanup = async () => {
    if (!current.current || !lock()) return;
    try { await settleDraft(current.current); setProblem(null); setDraftError(''); }
    catch (error) { setProblem({ title: '文件已保存，草稿整理失败', message: message(error), retry: () => { void retryCleanup(); }, canSave: true }); }
    finally { unlock(); }
  };

  const save = async (saveAs = false) => {
    const snapshot = current.current;
    if (!snapshot || (!saveAs && !isDirty(snapshot)) || !lock()) return;
    let savedPath: string | undefined;
    let committed = false;
    try {
      // A failed draft write must not prevent saving an emergency copy to disk.
      const result = await window.desktop.saveFile(snapshot.id, snapshot.name, snapshot.data, saveAs);
      if (!result) return;
      savedPath = result.filePath;
      const savedName = snapshot.name === '未命名绘图' ? result.filePath.split(/[\\/]/).pop()?.replace(/\.(excalidraw|json)$/i, '') || snapshot.name : snapshot.name;
      await workspaceService.saveToWorkspace(savedName, snapshot.data.elements, snapshot.data.appState, snapshot.data.files, snapshot.id, result.filePath);
      const latest = current.current!;
      const saved = { ...latest, name: savedName, filePath: result.filePath, committedFingerprint: fingerprint(snapshot.data) };
      update(saved);
      committed = true;
      // Write the committed marker before cleanup, so interruption remains safe.
      await settleDraft(saved);
      setDraftError('');
      setBeforeClear(null);
      setProblem(result.warning ? { title: '文件已保存，位置关联未完成', message: result.warning, retry: () => { void save(true); }, canSave: true } : null);
    } catch (error) {
      setProblem({ title: savedPath ? '文件已保存，工作区整理未完成' : '文件未能保存', message: `${savedPath ? `绘图已写入 ${savedPath}。` : '保存未能确认完成。'}画布仍在，请重试或另存副本。${message(error)}`, retry: () => { if (committed) void retryCleanup(); else void save(saveAs); }, canSave: true });
    } finally { unlock(); }
  };

  const changeScene = useCallback((data: Scene, id?: string) => {
    const previous = current.current;
    if (!previous || (id && previous.id !== id) || fingerprint(previous.data) === fingerprint(data)) return;
    update({ ...previous, data, updatedAt: Date.now() });
  }, [update]);

  const clear = async () => {
    const snapshot = current.current;
    if (!snapshot || !api.current || !lock()) return;
    try {
      // The destructive action is blocked until its before-image is durable.
      await window.desktop.checkpoint(snapshot);
      setBeforeClear(snapshot.data);
      const cleared = sceneData(snapshot.data.elements.map(element => ({ ...element, isDeleted: true, version: element.version + 1 })), snapshot.data.appState, snapshot.data.files);
      update({ ...snapshot, data: cleared, updatedAt: Date.now() });
      api.current.updateScene({ elements: cleared.elements, captureUpdate: 'IMMEDIATELY' });
      setClearDialog(false);
    } catch (error) {
      setClearDialog(false);
      setProblem({ title: '未清空画布', message: `清空前的恢复副本保存失败，原内容保持不变。${message(error)}`, retry: () => { void clear(); }, canSave: true });
    } finally { unlock(); }
  };

  const discard = async () => {
    const snapshot = current.current;
    if (!snapshot || !lock()) return;
    try {
      await writeTail.current.catch(() => undefined);
      await window.desktop.checkpoint(snapshot);
      await window.desktop.deleteDraft(snapshot.id);
      durable.current.delete(snapshot.id);
      update(null); api.current = null;
      setDiscardDialog(false);
      await reload();
    } catch (error) {
      setDiscardDialog(false);
      setProblem({ title: '未放弃草稿', message: `无法完成恢复保护，画布仍保留。${message(error)}`, retry: () => { void discard(); }, canSave: true });
    } finally { unlock(); }
  };

  const actions = useRef<(command: string) => void>(() => undefined);
  actions.current = command => {
    if (busyRef.current || clearDialog || discardDialog || renameDialog || exportDialog || problem || globalThis.document.querySelector('dialog[open]')) {
      if (command === 'close') window.desktop.cancelClose();
      return;
    }
    if ((loading || loadError) && command !== 'close') return;
    if (command === 'save') void save();
    else if (command === 'save-as') void save(true);
    else if (command === 'rename' && current.current) { setRenameError(''); setRenameDialog({ id: current.current.id, name: current.current.name }); }
    else if (command === 'export') requestExport();
    else if (command === 'export-settings') setExportDialog('settings');
    else if (command === 'clear') requestClear();
    else if (command === 'discard' && current.current && isDirty(current.current)) setDiscardDialog(true);
    else if (['workspace', 'close', 'new', 'open'].includes(command)) void navigate(command as 'workspace' | 'close' | 'new' | 'open');
  };
  useEffect(() => window.desktop.onCommand(command => actions.current(command)), []);
  // Capture before Excalidraw's own file shortcuts. Q/W and Escape keep their
  // native meanings; navigation is an explicit button or Cmd/Ctrl+Shift+H.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const name = event.key.toLowerCase();
      const command = name === 's' ? event.shiftKey ? 'save-as' : 'save' : name === 'e' && event.shiftKey ? 'export' : name === 'h' && event.shiftKey ? 'workspace' : name === 'n' ? 'new' : name === 'o' ? 'open' : null;
      if (command) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) actions.current(command); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  useEffect(() => {
    globalThis.document.title = document ? `${isDirty(document) ? '• ' : ''}${document.name} — My Excalidraw` : 'My Excalidraw';
  }, [document]);

  const rename = async () => {
    if (!renameDialog || !lock()) return;
    try {
      const { id } = renameDialog;
      const name = renameDialog.name.trim();
      if (!name) throw new Error('名称不能为空。');
      const active = current.current?.id === id ? current.current : null;
      const draft = active ? (isDirty(active) ? active : undefined) : drafts.find(item => item.id === id);
      if (draft && draft.name !== name) await persist({ ...draft, name });
      const saved = await workspaceService.getAllFiles();
      if (saved.some(file => file.id === id)) await workspaceService.renameFile(id, name);
      if (active) update({ ...active, name });
      await reload();
      setRenameDialog(null);
    } catch (error) { setRenameError(message(error)); }
    finally { unlock(); }
  };

  const dirty = document ? isDirty(document) : false;
  const hasDocument = !!document;
  const menuBusy = busy || loading || !!loadError || !!problem || clearDialog || discardDialog || !!renameDialog || !!exportDialog;
  const canClear = !!document?.data.elements.some(element => !element.isDeleted);
  useEffect(() => {
    window.desktop.setMenuState({ documentOpen: hasDocument, dirty, busy: menuBusy, canClear });
  }, [hasDocument, dirty, menuBusy, canClear]);
  const status = busy ? '正在处理…' : !dirty ? '已保存' : draftStatus === 'saved' ? '草稿已保留 · 未提交修改' : draftStatus === 'failed' ? '草稿保存失败 · 请勿关闭' : draftStatus === 'writing' ? '正在保留草稿…' : '有修改 · 等待保留草稿';
  return <div className="desktop-app" data-platform={window.desktop.platform}>
    <header className="app-titlebar" aria-label="窗口标题栏">
      {document ? <>
        <button disabled={menuBusy} onClick={() => void navigate('workspace')} title="返回工作区（⌘/Ctrl ⇧ H），不提交草稿">← 工作区</button>
        <div className="editor-title"><button className="document-name" disabled={menuBusy} title={document.filePath ? `重命名 · ${document.filePath}` : '重命名绘图'} onClick={() => { setRenameError(''); setRenameDialog({ id: document.id, name: document.name }); }}>{document.name}</button><span role="status" aria-live="polite">{status}</span></div>
        <div className="button-group"><button disabled={menuBusy || !dirty} onClick={() => setDiscardDialog(true)}>放弃草稿…</button><button disabled={menuBusy} onClick={() => void save(true)}>另存副本…</button><button disabled={menuBusy || !canClear} onClick={requestExport}>导出…</button><button className="primary" disabled={menuBusy || !dirty} onClick={() => void save()}>保存</button></div>
      </> : <><div className="app-identity">My Excalidraw</div><div className="titlebar-spacer" /><div className="button-group"><button disabled={menuBusy} onClick={() => void navigate('open')}>打开文件…</button><button className="primary" disabled={menuBusy} onClick={() => void navigate('new')}>新建绘图</button></div></>}
    </header>
    {notice && <div className="recovery-banner" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭提示">关闭</button></div>}
    {document ? <>
      {draftError && <div className="error-banner" role="alert"><span>草稿未写入磁盘：{draftError}</span><button onClick={() => { void flush().catch(error => setDraftError(message(error))); }}>重试保留草稿</button><button onClick={() => void save(true)}>另存副本…</button></div>}
      {beforeClear && <div className="recovery-banner"><span>已清空草稿，尚未覆盖原文件。清空前的内容已有恢复副本。</span><button disabled={busy} onClick={() => { if (api.current) { api.current.updateScene({ elements: beforeClear.elements, appState: { ...api.current.getAppState(), ...beforeClear.appState }, captureUpdate: 'IMMEDIATELY' }); api.current.addFiles(Object.values(beforeClear.files)); changeScene(beforeClear); setBeforeClear(null); } }}>恢复清空前内容</button></div>}
      <section ref={canvasContainer} className="editor-canvas" aria-label="绘图画布"><EditorBoundary key={document.id}><Suspense fallback={<p className="editor-loading" role="status">正在准备画布…</p>}><Editor key={document.id} document={document} onChange={changeScene} onAPI={setEditorAPI} onClear={requestClear} onExport={requestExport} /></Suspense></EditorBoundary></section>
    </> : loading ? <main className="workspace"><p role="status">正在读取工作区…</p></main> : loadError ? <main className="workspace"><h1>工作区未能读取</h1><p role="alert">{loadError}</p><p>为保护原数据，已暂停编辑。不会将读取失败当作空工作区。</p><button onClick={() => void reload()}>重试读取</button></main> : <WorkspacePage files={files} drafts={drafts} onOpenFile={file => { void openSaved(file); }} onOpenDraft={activate} onCreateNew={() => void navigate('new')} onRename={(id, name) => { setRenameError(''); setRenameDialog({ id, name }); }} />}
    {exportDialog && <ExportDialog name={document?.name ?? '绘图'} scene={exportDialog === 'image' ? document?.data ?? null : null} onClose={() => setExportDialog(null)} onExported={filePath => setNotice(`图像副本已导出：${filePath}`)} />}
    {renameDialog && <DecisionDialog title="重命名绘图" onCancel={() => { if (!busy) setRenameDialog(null); }}><form onSubmit={event => { event.preventDefault(); void rename(); }}><label>工作区名称<input autoFocus maxLength={120} value={renameDialog.name} onChange={event => setRenameDialog({ ...renameDialog, name: event.target.value })} /></label><p>只修改工作区名称，不改动绘图内容或磁盘文件名。</p>{renameError && <p role="alert">{renameError}</p>}<div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setRenameDialog(null)}>取消</button><button className="primary" disabled={busy || !renameDialog.name.trim()}>{busy ? '正在更新…' : '确认'}</button></div></form></DecisionDialog>}
    {clearDialog && <DecisionDialog title="清空当前草稿？" onCancel={() => { if (!busy) setClearDialog(false); }}><p>正式绘图不会被覆盖。我们会先保存清空前的恢复副本；如果保护失败，就不会清空。</p><p>清空后可以撤销，或点击「恢复清空前内容」。只有主动保存才会更新正式绘图。</p><div className="dialog-actions"><button autoFocus disabled={busy} onClick={() => setClearDialog(false)}>继续编辑</button><button className="danger" disabled={busy} onClick={() => void clear()}>保留副本并清空草稿</button></div></DecisionDialog>}
    {discardDialog && <DecisionDialog title="放弃这份草稿？" onCancel={() => { if (!busy) setDiscardDialog(false); }}><p>正式绘图保持不变。草稿会先保存到恢复副本，再从工作区移除。可从「文件 → 查看恢复副本」重新打开。</p><div className="dialog-actions"><button autoFocus disabled={busy} onClick={() => setDiscardDialog(false)}>继续编辑</button><button className="danger" disabled={busy} onClick={() => void discard()}>保留副本并放弃草稿</button></div></DecisionDialog>}
    {problem && <DecisionDialog title={problem.title} onCancel={() => { if (!busy) setProblem(null); }}><p role="alert">{problem.message}</p><div className="dialog-actions"><button autoFocus disabled={busy} onClick={() => setProblem(null)}>留在这里</button>{problem.canSave && <button disabled={busy} onClick={() => void save(true)}>另存副本…</button>}<button className="primary" disabled={busy} onClick={problem.retry}>重试</button></div></DecisionDialog>}
  </div>;
}
