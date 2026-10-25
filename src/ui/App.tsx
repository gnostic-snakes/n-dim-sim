import { useEffect } from 'react';
import { decodeScene, loadLocal, saveLocal } from '../scene/persist';
import { buildPreset } from '../scene/presets';
import { useApp } from '../scene/store';
import { TooltipLayer } from './controls';
import { GlossaryDialog, HelpDialog } from './Dialogs';
import { engine } from './engine';
import { GhostView } from './GhostView';
import { useMediaQuery } from './hooks';
import { Icon } from './icons';
import { InspectorPanel } from './InspectorPanel';
import { AxesGizmo, ErrorBanner, ObjectLabels, SliceHud, Toast, ViewTools } from './Overlays';
import { ScenePanel } from './ScenePanel';
import { Timeline } from './Timeline';
import { TopBar } from './TopBar';
import { useUi } from './uiStore';
import { Viewport } from './Viewport';

/** Load the initial scene: a shared link, else the last session, else a friendly preset. */
async function boot() {
  const app = useApp.getState();
  const hash = location.hash;
  if (hash.startsWith('#s=')) {
    try {
      const scene = await decodeScene(hash.slice(3));
      app.loadScene(scene, { keepHistory: false });
      return;
    } catch {
      app.notify('That link could not be read; starting fresh.');
    }
  }
  const saved = loadLocal();
  if (saved) {
    app.loadScene(saved, { keepHistory: false });
    return;
  }
  const first = buildPreset('tesseract-spin');
  if (first) {
    app.loadScene(first, { keepHistory: false });
    app.setPlaying(true);
  }
}

function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return useApp.subscribe((s, prev) => {
      if (s.scene === prev.scene) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => saveLocal({ ...useApp.getState().scene, camera: engine.camera.orbit }), 600);
    });
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      const app = useApp.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (typing && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return;
        e.preventDefault();
        if (e.shiftKey) app.redo();
        else app.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        app.redo();
        return;
      }
      if (typing || mod || e.altKey) return;
      const d = app.scene.timeline.duration;
      switch (e.key) {
        case ' ':
          if (t.tagName === 'BUTTON') return;
          e.preventDefault();
          app.setPlaying(!app.playing);
          break;
        case 'Home':
          app.setTime(0);
          break;
        case 'End':
          app.setTime(d);
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (t.getAttribute('role') === 'radio' || t.classList.contains('slider')) return;
          e.preventDefault();
          app.setPlaying(false);
          app.setTime(app.time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1));
          break;
        }
        case 'f':
        case 'F':
          engine.camera.animateTo(app.scene.camera ?? { yaw: 0.65, pitch: 0.38, distance: 8.5, target: [0, 0, 0] });
          break;
        case '1':
        case '2':
        case '3':
        case '4': {
          const shading = (['solid', 'cells', 'tilt', 'depth'] as const)[Number(e.key) - 1];
          app.setScene((s) => ({ ...s, view: { ...s.view, shading } }));
          break;
        }
        case '?':
          useUi.getState().setDialog('help');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const ghostVisible = useApp((s) => s.scene.view.ghost.visible);
  const dialog = useUi((s) => s.dialog);
  const tab = useUi((s) => s.mobileTab);
  const mobile = useMediaQuery('(max-width: 900px)');

  useEffect(() => {
    void boot();
  }, []);
  useAutosave();
  useShortcuts();

  const setTab = (t: 'scene' | 'inspect') => useUi.getState().setMobileTab(tab === t ? null : t);

  return (
    <div className="app">
      <TopBar />
      <aside className={`side left${tab === 'scene' ? ' open' : ''}`} aria-label="Scene and transforms">
        <ScenePanel />
      </aside>
      <main className="main">
        <Viewport />
        <ObjectLabels />
        <SliceHud />
        <AxesGizmo />
        <ViewTools />
        {ghostVisible && !(mobile && tab) && <GhostView />}
        <ErrorBanner />
      </main>
      <aside className={`side right${tab === 'inspect' ? ' open' : ''}`} aria-label="Slice, info and view">
        <InspectorPanel />
      </aside>
      <Timeline />
      <nav className="mobile-tabs" aria-label="Panels">
        <button className={tab === 'scene' ? 'on' : ''} onClick={() => setTab('scene')}>
          <Icon name="layers" /> <div>Shape &amp; transforms</div>
        </button>
        <button className={tab === 'inspect' ? 'on' : ''} onClick={() => setTab('inspect')}>
          <Icon name="sliders" /> <div>Slice &amp; info</div>
        </button>
      </nav>
      <TooltipLayer />
      <Toast />
      {dialog === 'help' && <HelpDialog />}
      {dialog === 'glossary' && <GlossaryDialog />}
    </div>
  );
}
