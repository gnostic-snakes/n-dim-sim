/** Top bar: presets, dimension, lessons, undo/redo, file and sharing actions, help. */
import { useRef } from 'react';
import { MAX_DIM, MIN_DIM, parsePlane } from '../math/axes';
import { downloadBlob, recordingSupported, startRecording } from '../render/recorder';
import { defaultScene } from '../scene/model';
import { encodeScene, sanitizeScene, sceneToFile } from '../scene/persist';
import { PRESETS, type Preset } from '../scene/presets';
import { useApp } from '../scene/store';
import { IconButton, PopButton, Segmented } from './controls';
import { engine } from './engine';
import { Icon } from './icons';
import { lessonScene } from './OrderLesson';
import { useUi } from './uiStore';

const GROUPS: Preset['group'][] = ['Classics', 'Polytopes', 'Curved', 'Flatland', 'Higher dimensions'];

function PresetMenu({ onPick }: { onPick: (p: Preset) => void }) {
  return (
    <div className="menu" role="menu" style={{ width: 340 }}>
      {GROUPS.map((g) => (
        <div key={g}>
          <div className="menu-group">{g}</div>
          {PRESETS.filter((p) => p.group === g).map((p) => (
            <button key={p.id} className="menu-item" role="menuitem" onClick={() => onPick(p)}>
              <span>{p.title}</span>
              <span className="desc">{p.description}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function loadPreset(p: Preset) {
  const app = useApp.getState();
  app.loadScene(p.build());
  app.setPlaying(true);
  useUi.getState().setLesson(null);
}

export async function copyShareLink() {
  const app = useApp.getState();
  const code = await encodeScene({ ...app.scene, camera: engine.camera.orbit });
  const url = `${location.origin}${location.pathname}#s=${code}`;
  history.replaceState(null, '', `#s=${code}`);
  try {
    await navigator.clipboard.writeText(url);
    app.notify('Link copied to the clipboard');
  } catch {
    app.notify('Link is in the address bar: copy it from there');
  }
}

export function recordVideo() {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas.viewport');
  const app = useApp.getState();
  const ui = useUi.getState();
  if (!canvas || !recordingSupported()) {
    app.notify('Video recording is not supported in this browser');
    return;
  }
  if (ui.recording) return;
  const duration = app.scene.timeline.duration / Math.max(0.05, app.speed);
  app.setPlaying(false);
  app.setTime(0);
  ui.setRecording(true);
  const rec = startRecording(canvas);
  app.notify(`Recording one loop (${duration.toFixed(1)} s)…`);
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Give the encoder a moment to start before the motion begins, then record one full loop.
  const warmup = setTimeout(() => {
    useApp.getState().setTime(0);
    useApp.getState().setPlaying(true);
    timer = setTimeout(() => rec.stop(), duration * 1000 + 250);
  }, 350);
  (window as unknown as { __stopRecording?: () => void }).__stopRecording = () => {
    clearTimeout(warmup);
    if (timer) clearTimeout(timer);
    rec.stop();
  };
  rec.done
    .then(({ blob, ext }) => {
      if (blob.size === 0) {
        useApp.getState().notify('The recording came out empty: try again with a shorter or slower animation');
        return;
      }
      downloadBlob(blob, `${slug(app.scene.title)}.${ext}`);
      useApp.getState().notify('Video saved');
    })
    .catch(() => useApp.getState().notify('Recording failed'))
    .finally(() => useUi.getState().setRecording(false));
}

export function stopRecording() {
  (window as unknown as { __stopRecording?: () => void }).__stopRecording?.();
}

export function toggleLesson() {
  const ui = useUi.getState();
  if (ui.lesson === 'order') {
    ui.setLesson(null);
    return;
  }
  const app = useApp.getState();
  if (!app.scene.objects.some((o) => o.id === 'lessonA')) {
    app.setPlaying(false);
    app.loadScene(lessonScene(parsePlane('xy'), parsePlane('yz'), 40, 55, Math.max(4, app.scene.dim)));
  }
  ui.setLesson('order');
  ui.setMobileTab('scene');
}

function slug(s?: string): string {
  return (s || 'slice').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'slice';
}

export function TopBar() {
  const dim = useApp((s) => s.scene.dim);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const lesson = useUi((s) => s.lesson);
  const recording = useUi((s) => s.recording);
  const fileRef = useRef<HTMLInputElement>(null);
  const dims = Array.from({ length: MAX_DIM - MIN_DIM + 1 }, (_, i) => MIN_DIM + i);

  const openFile = async (file: File) => {
    const app = useApp.getState();
    try {
      const scene = sanitizeScene(JSON.parse(await file.text()));
      app.loadScene(scene);
      app.notify(`Opened “${scene.title ?? file.name}”`);
    } catch (e) {
      app.notify(`Could not open that file: ${e instanceof Error ? e.message : 'invalid scene'}`);
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden>
          <path d="M18 22 L38 14 L50 30 L30 38 Z" fill="none" stroke="#6cc3d5" strokeWidth="4" strokeLinejoin="round" />
          <path d="M14 34 L34 26 L46 42 L26 50 Z" fill="#f2a65a" stroke="#f2a65a" strokeWidth="4" strokeLinejoin="round" />
        </svg>
        Slice <small>4D cross-sections</small>
      </div>
      <PopButton
        className="btn small"
        label={
          <>
            <Icon name="sparkles" size={14} /> Presets <Icon name="chevronDown" size={14} />
          </>
        }
        hint="Ready-made demos"
      >
        {(close) => (
          <PresetMenu
            onPick={(p) => {
              loadPreset(p);
              close();
            }}
          />
        )}
      </PopButton>
      <div className="hide-mobile">
        <Segmented
          label="Dimension"
          value={dim}
          onChange={(d) => useApp.getState().setDimension(d)}
          options={dims.map((d) => ({
            value: d,
            label: d === 3 ? 'Flatland' : `${d}D`,
            hint: d === 3 ? '3D shapes sliced by a 2D plane: the warm-up analogy' : `${d}-dimensional shapes, sliced to 3D`,
          }))}
        />
      </div>
      <select
        className="select show-mobile"
        style={{ flex: 'none', height: 28, fontSize: 12 }}
        aria-label="Dimension"
        value={dim}
        onChange={(e) => useApp.getState().setDimension(Number(e.target.value))}
      >
        {dims.map((d) => (
          <option key={d} value={d}>
            {d === 3 ? 'Flatland' : `${d}D`}
          </option>
        ))}
      </select>
      <button className={`btn small hide-mobile${lesson === 'order' ? ' active' : ''}`} onClick={toggleLesson}>
        <Icon name="swap" size={14} /> Order matters
      </button>
      <span className="spacer" />
      <IconButton icon="undo" hint="Undo (Ctrl+Z)" onClick={() => useApp.getState().undo()} disabled={!canUndo} />
      <IconButton icon="redo" hint="Redo (Ctrl+Shift+Z)" onClick={() => useApp.getState().redo()} disabled={!canRedo} />
      <IconButton icon="share" hint="Copy a link to this scene" onClick={() => void copyShareLink()} />
      {recording ? (
        <button className="btn small active" onClick={stopRecording}>
          <Icon name="stop" size={12} /> Stop
        </button>
      ) : (
        <IconButton icon="record" hint="Record one loop as a video" onClick={recordVideo} />
      )}
      <PopButton className="btn ghost icon" label={<Icon name="menu" />} hint="More">
        {(close) => (
          <div className="menu" role="menu">
            <button
              className="menu-item row-item"
              role="menuitem"
              onClick={() => {
                useApp.getState().loadScene(defaultScene(useApp.getState().scene.dim));
                close();
              }}
            >
              <Icon name="plus" size={14} /> New scene
            </button>
            <button
              className="menu-item row-item"
              role="menuitem"
              onClick={() => {
                const s = useApp.getState().scene;
                downloadBlob(new Blob([sceneToFile({ ...s, camera: engine.camera.orbit })], { type: 'application/json' }), `${slug(s.title)}.slice.json`);
                close();
              }}
            >
              <Icon name="download" size={14} /> Save scene file…
            </button>
            <button
              className="menu-item row-item"
              role="menuitem"
              onClick={() => {
                fileRef.current?.click();
                close();
              }}
            >
              <Icon name="upload" size={14} /> Open scene file…
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item row-item"
              role="menuitem"
              onClick={() => {
                const canvas = document.querySelector<HTMLCanvasElement>('canvas.viewport');
                canvas?.toBlob((b) => b && downloadBlob(b, `${slug(useApp.getState().scene.title)}.png`), 'image/png');
                close();
              }}
            >
              <Icon name="download" size={14} /> Save image (PNG)
            </button>
            <button
              className="menu-item row-item"
              role="menuitem"
              onClick={() => {
                recordVideo();
                close();
              }}
            >
              <Icon name="film" size={14} /> Record video (one loop)
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item row-item"
              role="menuitem"
              onClick={() => {
                toggleLesson();
                close();
              }}
            >
              <Icon name="swap" size={14} /> Lesson: order matters
            </button>
            <button
              className="menu-item row-item"
              role="menuitem"
              onClick={() => {
                useUi.getState().setDialog('glossary');
                close();
              }}
            >
              <Icon name="book" size={14} /> Glossary
            </button>
            <button
              className="menu-item row-item"
              role="menuitem"
              onClick={() => {
                useUi.getState().setDialog('help');
                close();
              }}
            >
              <Icon name="help" size={14} /> Help &amp; shortcuts
            </button>
          </div>
        )}
      </PopButton>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = '';
        }}
      />
    </header>
  );
}
