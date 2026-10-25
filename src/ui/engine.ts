/**
 * The animation/render loop, shared by the main view and the context inset.
 * It advances playback, resolves the animated scene, computes the frame data
 * (slices, transforms) once, renders, and notifies subscribers.
 */
import { CameraController, DEFAULT_CAMERA, DEFAULT_FLAT } from '../render/camera';
import { pickObject } from '../render/pick';
import { HopfRenderer } from '../render/hopfRenderer';
import { Renderer } from '../render/renderer';
import { resolveScene } from '../scene/animation';
import { FrameCache, type FrameData } from '../scene/frame';
import type { Scene } from '../scene/model';
import { useApp } from '../scene/store';
import { useUi } from './uiStore';

/** Called every tick; `changed` is true when the frame was (re)rendered. */
type Listener = (frame: FrameData, changed: boolean) => void;

export class Engine {
  readonly camera = new CameraController();
  renderer: Renderer | null = null;
  hopf: HopfRenderer | null = null;
  frame: FrameData | null = null;
  error: string | null = null;
  fps = 0;

  private cache = new FrameCache();
  private listeners = new Set<Listener>();
  private raf = 0;
  private lastNow = 0;
  private resolved: { scene: Scene; time: number; value: Scene } | null = null;
  private sceneIds = new WeakMap<Scene, number>();
  private nextSceneId = 1;
  private canvas: HTMLCanvasElement | null = null;
  private detach: (() => void) | null = null;
  private lastCameraNonce = -1;
  private forced = true;

  private createRenderer(canvas: HTMLCanvasElement) {
    try {
      this.renderer = new Renderer(canvas);
      this.hopf = null;
      this.error = null;
      // Debug knobs: ?samples=1&scale=0.5 (handy on software GL).
      const q = new URLSearchParams(location.search);
      if (q.has('samples')) this.renderer.maxSamples = Math.max(1, Number(q.get('samples')) || 1);
      if (q.has('scale')) {
        this.renderer.scale = Math.min(1, Math.max(0.1, Number(q.get('scale')) || 1));
        this.renderer.autoScale = false;
      }
    } catch (e) {
      this.renderer = null;
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.forced = true;
  }

  private onContextLost = (e: Event) => {
    // Keep the context restorable; GPU resets and driver updates can drop it.
    e.preventDefault();
    this.renderer = null;
    this.hopf = null;
    this.error = 'The graphics context was lost (for example after a GPU reset). Trying to restore it…';
  };

  private onContextRestored = () => {
    if (this.canvas) this.createRenderer(this.canvas);
  };

  mount(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.createRenderer(canvas);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.detach = this.camera.attach(canvas);
    this.camera.onInteract = () => this.requestRender();
    this.camera.onClick = (cx, cy) => {
      if (!this.frame || !this.canvas) return;
      const r = this.canvas.getBoundingClientRect();
      const id = pickObject(this.frame, this.camera, cx - r.left, cy - r.top, r.width, r.height);
      if (id) useApp.getState().select(id);
    };
    this.lastNow = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  unmount() {
    cancelAnimationFrame(this.raf);
    this.canvas?.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas?.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.detach?.();
    this.renderer?.dispose();
    this.renderer = null;
    this.hopf?.dispose();
    this.hopf = null;
    this.canvas = null;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    if (this.frame) l(this.frame, true);
    return () => this.listeners.delete(l);
  }

  requestRender() {
    this.forced = true;
  }

  private sceneId(s: Scene): number {
    let id = this.sceneIds.get(s);
    if (id === undefined) {
      id = this.nextSceneId++;
      this.sceneIds.set(s, id);
    }
    return id;
  }

  /** The scene resolved at the current playhead (memoized). */
  resolvedScene(): Scene {
    const { scene, time } = useApp.getState();
    if (this.resolved && this.resolved.scene === scene && this.resolved.time === time) return this.resolved.value;
    const value = resolveScene(scene, time);
    this.resolved = { scene, time, value };
    return value;
  }

  private tick(now: number) {
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    if (dt > 0) this.fps = this.fps * 0.9 + (1 / dt) * 0.1;

    if (useUi.getState().special === 'hopf') {
      this.tickHopf(dt);
      return;
    }

    const app = useApp.getState();
    if (app.playing) {
      const { duration, loop } = app.scene.timeline;
      let t = app.time + dt * app.speed;
      if (t >= duration) {
        if (loop) t = duration > 0 ? t % duration : 0;
        else {
          t = duration;
          app.setPlaying(false);
        }
      }
      app.setTime(t);
    }

    const state = useApp.getState();
    if (state.cameraNonce !== this.lastCameraNonce) {
      this.lastCameraNonce = state.cameraNonce;
      const cam = state.scene.camera ?? DEFAULT_CAMERA;
      if (this.lastCameraNonce === 0) this.camera.set(cam);
      else this.camera.animateTo(cam);
      this.camera.flat = structuredClone(DEFAULT_FLAT);
    }
    const flat = state.scene.dim === 3;
    this.camera.mode = flat ? 'flat' : 'orbit';
    const moved = this.camera.update(dt);

    const scene = this.resolvedScene();
    const frame = this.cache.compute(scene);
    this.frame = frame;

    const canvas = this.canvas;
    const r = this.renderer;
    if (!canvas || !r) {
      for (const l of this.listeners) l(frame, true);
      return;
    }
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cam = this.camera.orbit;
    const camKey = flat
      ? `${this.camera.flat.center.join(',')}|${this.camera.flat.unitsPerPx}`
      : `${cam.yaw.toFixed(5)}|${cam.pitch.toFixed(5)}|${cam.distance.toFixed(5)}|${cam.target.map((v) => v.toFixed(5)).join(',')}`;
    const key = `${this.sceneId(state.scene)}|${state.time}|${camKey}|${cssW}x${cssH}@${dpr}|${state.selectedId}`;
    const changed = moved || this.forced || key !== this.lastKey;
    if (changed || !r.converged) {
      // Consecutive changed frames mean continuous motion: let resolution adapt to the frame rate.
      if (changed && this.prevChanged) r.reportFrameInterval(dt * 1000);
      const highlight = state.scene.objects.findIndex((o) => o.id === state.selectedId);
      r.render(frame, this.camera, { cssWidth: cssW, cssHeight: cssH, dpr, key, highlight });
      this.error = r.lastError;
      this.forced = false;
      this.lastKey = key;
    }
    this.prevChanged = changed;
    for (const l of this.listeners) l(frame, changed);
  }

  private lastKey = '';
  private prevChanged = false;

  /** The Hopf fibration view replaces the slice view while it is open. */
  private tickHopf(dt: number) {
    const ui = useUi.getState();
    const h = ui.hopf;
    if (h.playing) ui.setHopf({ angle: (h.angle + (dt * h.speed * Math.PI) / 180) % (Math.PI * 2) });
    this.camera.mode = 'orbit';
    const moved = this.camera.update(dt);
    const canvas = this.canvas;
    const r = this.renderer;
    if (!canvas || !r) return;
    try {
      this.hopf ??= new HopfRenderer(r.gl);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return;
    }
    const s = useUi.getState().hopf;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const key = `hopf|${JSON.stringify(s)}|${JSON.stringify(this.camera.orbit)}|${canvas.clientWidth}x${canvas.clientHeight}`;
    if (moved || this.forced || key !== this.lastKey) {
      this.hopf.render(canvas, this.camera, s, dpr);
      this.lastKey = key;
      this.forced = false;
    }
  }
}

export const engine = new Engine();
if (typeof window !== 'undefined') (window as unknown as { __engine: Engine }).__engine = engine;
