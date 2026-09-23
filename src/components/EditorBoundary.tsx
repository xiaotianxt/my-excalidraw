import { Component, type ReactNode } from 'react';

// Keep document controls alive if the editor cannot render a scene. In-memory
// data remains owned by App, so the user can still save a copy or leave safely.
export class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <div className="error-banner" role="alert">画布暂时无法显示。内容仍保留在当前窗口；请使用上方「另存副本」保护数据，或返回工作区。不会自动清空或覆盖绘图。</div>
      : this.props.children;
  }
}
