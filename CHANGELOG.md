# Changelog | 更新日志

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.3] - 2026-09-22

### Added
- Recoverable on-disk drafts, separate from explicit file saves.
- Native PNG/SVG/JPEG/WebP/GIF/BMP/AVIF image opening, with editable scene recovery for embedded Excalidraw PNG/SVG files.
- PNG/SVG exports with embedded scenes by default; persistent PNG scale and DPI preferences (default 2× / 300 DPI).
- Custom macOS title bar with native traffic lights and synchronized native file/edit menus.
- Content-addressed previews rendered by the official Excalidraw renderer, not approximate hand-written SVG.

### Fixed
- Failed saves and destructive actions retain the canvas and recoverable before-images.
- External file changes block overwriting; normal close/quit flushes drafts without committing them.
- Unchanged drawings no longer trigger periodic writes; rename only changes small label metadata.
- New/explicitly saved workspace documents live on disk, avoiding browser storage limits for images. Legacy storage remains read-only; no bulk migration.
- PNG DPI is written as pHYs metadata without removing embedded scene chunks.

### Removed
- Web/PWA file services, deployment configuration, icons and compatibility aliases.
- Repurposing Cmd+Q as workspace navigation; system quit behavior is restored.

### Release
- Node 22 CI, persistence tests and real Electron image round-trip checks.
- All desktop installers and SHA-256 checksums must finish before a release becomes public.
- Hosted builds are not developer-signed/notarized; this limitation is disclosed in the release notes.

## [0.1.2] - 2025-09-13

### Fixed | 修复
- 🔧 **GitHub API Permissions** - Fixed 403 Forbidden error by disabling electron-builder auto-publish
- 🔧 **Release Workflow** - Improved GitHub Actions permissions and error handling
- 🔧 **Cross-Platform Compatibility** - Fixed PowerShell compatibility issues on Windows runners
- 🔧 **Architecture Separation** - Separate macOS x64 and arm64 builds for pure architecture packages
- 🔧 **Caching Optimization** - Fixed cache path validation errors and optimized caching strategy

## [0.1.1] - 2025-09-13

### Fixed | 修复
- 🔧 **Build Issues** - Fixed Linux .deb package build by adding author email
- 🔧 **CI/CD Improvements** - Enhanced GitHub Actions workflow with better error handling and caching
- 🔧 **Repository Configuration** - Updated GitHub repository URLs and publish settings

## [0.1.0] - 2025-09-13

### Added | 新增功能
- 🎨 **Full Excalidraw Integration** - Complete drawing functionality with all native features
- 📁 **Workspace Management** - Visual file browser with grid and list views
- 🖼️ **Thumbnail Previews** - Automatic thumbnail generation for all drawings
- ✏️ **Inline Editing** - Click-to-edit file names with instant feedback
- 🎯 **Batch Operations** - Select and manage multiple files at once
- ⭐ **Favorites System** - Mark important files as favorites
- 🌓 **Theme Support** - Light, dark, and system theme options
- ⌨️ **Keyboard Shortcuts** - Comprehensive keyboard navigation
- 💾 **Auto-save** - Automatic saving every 30 seconds
- 🔄 **Smart Save-and-Return** - Intelligent workflow between workspace and drawing

### Technical Features | 技术特性
- ⚡ **Modern Tech Stack** - React 18, TypeScript, Electron, Vite
- 🎨 **Tailwind CSS** - Custom CSS variables for theming
- 🧩 **Modular Architecture** - Reusable components and services
- 📱 **Responsive Design** - Adapts to different screen sizes
- 🔒 **Type Safety** - Full TypeScript coverage
- 🚀 **Performance Optimized** - Efficient rendering and file handling

### User Experience | 用户体验
- 🖱️ **Intuitive Interface** - Clean, distraction-free design
- 🎯 **Context Menus** - Right-click actions for quick access
- 📋 **File Operations** - Rename, duplicate, delete, and organize
- 🔍 **Visual Feedback** - Hover effects and smooth transitions
- 📊 **File Metadata** - Creation date, modification date, element count, file size
- 🎨 **Custom Styling** - Excalidraw-inspired purple theme

### Components | 组件
- `WorkspacePage` - Main workspace interface
- `FileCard` - Individual file display with actions
- `FileGrid` - Grid and list view layouts
- `EditableText` - Reusable inline editing component
- `ThemeToggle` - Theme switching interface
- `WorkspaceFilters` - File filtering and batch operations
- `WorkspaceDialogs` - Confirmation and help dialogs

### Services | 服务
- `WorkspaceService` - File management and storage
- `FileService` - File I/O operations
- `ExportService` - Export functionality
- `ThumbnailService` - Thumbnail generation

---

## Development Notes | 开发说明

### Architecture Decisions | 架构决策
- **Component Separation**: Extracted `EditableText` as a reusable component for better maintainability
- **Service Layer**: Separated business logic into dedicated service classes
- **Theme System**: Used CSS variables for dynamic theming support
- **State Management**: React Context for global state (theme) and local state for components

### Performance Optimizations | 性能优化
- **useCallback**: Optimized event handlers to prevent unnecessary re-renders
- **Thumbnail Caching**: Efficient thumbnail generation and storage
- **Lazy Loading**: Components load only when needed
- **Debounced Auto-save**: Prevents excessive save operations

### Future Enhancements | 未来增强
- [ ] Cloud sync integration
- [ ] Collaborative editing
- [ ] Plugin system
- [ ] Advanced search and filtering
- [ ] Export to multiple formats
- [ ] Version history
- [ ] Custom templates

---

**Note**: This is the initial release version. Future versions will follow semantic versioning.

**注意**：这是初始发布版本。未来版本将遵循语义化版本控制。
