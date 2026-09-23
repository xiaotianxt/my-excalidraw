import { useMemo, useState } from 'react';
import type { Draft } from '../document';
import type { WorkspaceFile } from '../services/WorkspaceService';
import { DocumentPreview } from './DocumentPreview';

interface Props {
  files: WorkspaceFile[];
  drafts: Draft[];
  onOpenFile: (file: WorkspaceFile) => void;
  onOpenDraft: (draft: Draft) => void;
  onCreateNew: () => void;
  onRename: (id: string, name: string) => void;
}

export function WorkspacePage({ files, drafts, onOpenFile, onOpenDraft, onCreateNew, onRename }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'drafts'>('all');
  const [sort, setSort] = useState<'updated' | 'name'>('updated');
  const [view, setView] = useState<'grid' | 'list'>(() => localStorage.getItem('excalidraw-workspace-view') === 'list' ? 'list' : 'grid');
  const [viewError, setViewError] = useState('');
  const changeView = (value: typeof view) => {
    setView(value);
    try { localStorage.setItem('excalidraw-workspace-view', value); setViewError(''); }
    catch { setViewError('显示偏好未能保存，绘图数据不受影响。'); }
  };
  const rows = useMemo(() => {
    const pending = new Map(drafts.map(draft => [draft.id, draft]));
    const savedIds = new Set(files.map(file => file.id));
    const items: { id: string; name: string; date: number; file?: WorkspaceFile; draft?: Draft }[] = files.map(file => ({ id: file.id, name: pending.get(file.id)?.name ?? file.name, date: pending.get(file.id)?.updatedAt ?? file.updatedAt, file, draft: pending.get(file.id) }));
    for (const draft of drafts) if (!savedIds.has(draft.id)) items.push({ id: draft.id, name: draft.name, date: draft.updatedAt, draft });
    return items.filter(item => (filter === 'all' || item.draft) && item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.date - a.date);
  }, [files, drafts, query, filter, sort]);

  return <main className="workspace">
    <header className="workspace-heading"><div><h1>工作区</h1><p>继续草稿，或打开一张绘图。</p></div><span className="workspace-count">{files.length} 张绘图 · {drafts.length} 份草稿</span></header>
    <section className="workspace-tools" aria-label="筛选绘图">
      <div className="button-group" aria-label="文件类型"><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部绘图</button><button aria-pressed={filter === 'drafts'} onClick={() => setFilter('drafts')}>草稿 <span className="count">{drafts.length}</span></button></div>
      <input type="search" aria-label="搜索绘图" placeholder="搜索绘图名称" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="排序方式" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="updated">最近修改</option><option value="name">名称</option></select>
      <div className="button-group view-switch" aria-label="显示方式"><button aria-pressed={view === 'grid'} onClick={() => changeView('grid')}>缩略图</button><button aria-pressed={view === 'list'} onClick={() => changeView('list')}>列表</button></div>
    </section>
    <p className="workspace-note">草稿会自动保留在这台电脑上；只有点击「保存」才更新正式绘图。</p>
    {viewError && <p role="status" className="workspace-note">{viewError}</p>}
    {rows.length ? <ul className="document-list" data-view={view}>{rows.map(item => {
      const data = item.draft?.data ?? item.file?.data;
      return <li key={item.id}>
        <button className="document-open" aria-label={`打开 ${item.name}${item.draft ? '（草稿）' : ''}`} onClick={() => { if (item.draft) onOpenDraft(item.draft); else if (item.file) onOpenFile(item.file); }}>
          {data && <DocumentPreview id={item.id} scene={data} />}
          <span className="document-label"><strong>{item.name}</strong><span>{item.draft ? '有未提交修改 · 继续草稿' : item.file?.filePath ? item.file.filePath : '保存在原工作区'}</span></span>
        </button>
        <div className="document-meta">
          {item.draft && <span className="draft-badge">草稿</span>}
          <time dateTime={new Date(item.date).toISOString()}>{new Date(item.date).toLocaleDateString()}</time>
          <button className="quiet" aria-label={`重命名 ${item.name}`} onClick={() => onRename(item.id, item.name)}>重命名</button>
        </div>
      </li>;
    })}</ul> : <section className="empty-workspace"><h2>{query ? '没有找到匹配的绘图' : filter === 'drafts' ? '没有未提交的草稿' : '从一张绘图开始'}</h2><p>{query ? '试试其他名称，或清除搜索。' : '新建绘图，或打开现有的 .excalidraw 文件。'}</p>{!query && <button onClick={onCreateNew}>新建绘图</button>}</section>}
  </main>;
}
