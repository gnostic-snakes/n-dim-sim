/**
 * Our 3D "eyes": an orbit camera for viewing the slice (and a 2D pan/zoom
 * camera for Flatland). Moving the camera never changes the n-D state.
 */
import type { CameraState } from '../scene/model';

export type V3 = [number, number, number];

export interface CameraBasis {
  eye: V3;
  right: V3;
  up: V3;
  forward: V3;
  tanHalfFov: number;
}

export const DEFAULT_CAMERA: CameraState = { yaw: 0.65, pitch: 0.38, distance: 9.5, target: [0, 0, 0] };
export const FOV_DEG = 36;

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function cameraBasis(c: CameraState): CameraBasis {
  const cp = Math.cos(c.pitch);
  const dir: V3 = [cp * Math.sin(c.yaw), Math.sin(c.pitch), cp * Math.cos(c.yaw)];
  const eye: V3 = [c.target[0] + dir[0] * c.distance, c.target[1] + dir[1] * c.distance, c.target[2] + dir[2] * c.distance];
  const forward = norm([-dir[0], -dir[1], -dir[2]]);
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { eye, right, up, forward, tanHalfFov: Math.tan((FOV_DEG * Math.PI) / 360) };
}

export interface FlatCamera {
  /** World point at the viewport centre. */
  center: [number, number];
  /** World units per CSS pixel. */
  unitsPerPx: number;
}

export const DEFAULT_FLAT: FlatCamera = { center: [0, 0], unitsPerPx: 0.012 };

/**
 * Pointer/wheel/touch controls with a little inertia. Mutates its camera
 * state and reports whether anything moved via `update`.
 */
export class CameraController {
  orbit: CameraState = structuredClone(DEFAULT_CAMERA);
  flat: FlatCamera = structuredClone(DEFAULT_FLAT);
  mode: 'orbit' | 'flat' = 'orbit';
  /** Called once per user interaction start (e.g. to cancel camera animations). */
  onInteract?: () => void;
  /** Called for a click (press and release without dragging), in client coordinates. */
  onClick?: (clientX: number, clientY: number) => void;

  private velYaw = 0;
  private velPitch = 0;
  private dirty = true;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPinch = 0;
  private lastMid: { x: number; y: number } | null = null;
  private dragButton = 0;
  private press: { x: number; y: number; moved: boolean } | null = null;
  private anim: { from: CameraState; to: CameraState; t: number; dur: number } | null = null;
  private el: HTMLElement | null = null;

  attach(el: HTMLElement): () => void {
    this.el = el;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button > 2) return;
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragButton = e.button === 2 || e.button === 1 || e.shiftKey ? 2 : 0;
      this.press = this.pointers.size === 1 && e.button === 0 ? { x: e.clientX, y: e.clientY, moved: false } : null;
      this.velYaw = 0;
      this.velPitch = 0;
      this.anim = null;
      this.lastPinch = 0;
      this.lastMid = null;
      this.onInteract?.();
    };
    const move = (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 4) this.press.moved = true;
      if (this.pointers.size >= 2) {
        const pts = [...this.pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        if (this.lastPinch > 0) this.zoom(this.lastPinch / dist, mid.x, mid.y);
        if (this.lastMid) this.pan(mid.x - this.lastMid.x, mid.y - this.lastMid.y);
        this.lastPinch = dist;
        this.lastMid = mid;
        return;
      }
      if (this.mode === 'flat' || this.dragButton === 2) {
        this.pan(dx, dy);
      } else {
        this.rotate(dx, dy);
        this.velYaw = -dx * 0.006;
        this.velPitch = dy * 0.006;
      }
    };
    const up = (e: PointerEvent) => {
      const wasPress = this.press;
      this.press = null;
      if (wasPress && !wasPress.moved && this.pointers.size === 1 && e.type === 'pointerup') {
        this.velYaw = 0;
        this.velPitch = 0;
        this.onClick?.(e.clientX, e.clientY);
      }
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) {
        this.lastPinch = 0;
        this.lastMid = null;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.anim = null;
      this.zoom(Math.exp(delta * 0.0012), e.clientX, e.clientY);
    };
    const context = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', context);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', context);
      this.el = null;
    };
  }

  get interacting(): boolean {
    return this.pointers.size > 0;
  }

  rotate(dx: number, dy: number) {
    this.orbit.yaw -= dx * 0.006;
    this.orbit.pitch = Math.max(-1.52, Math.min(1.52, this.orbit.pitch + dy * 0.006));
    this.dirty = true;
  }

  pan(dx: number, dy: number) {
    if (this.mode === 'flat') {
      this.flat.center = [this.flat.center[0] - dx * this.flat.unitsPerPx, this.flat.center[1] + dy * this.flat.unitsPerPx];
    } else {
      const b = cameraBasis(this.orbit);
      const h = this.el?.clientHeight || 800;
      const s = (2 * this.orbit.distance * b.tanHalfFov) / h;
      const t = this.orbit.target;
      this.orbit.target = [
        t[0] - (b.right[0] * dx - b.up[0] * dy) * s,
        t[1] - (b.right[1] * dx - b.up[1] * dy) * s,
        t[2] - (b.right[2] * dx - b.up[2] * dy) * s,
      ];
    }
    this.dirty = true;
  }

  zoom(factor: number, clientX?: number, clientY?: number) {
    if (this.mode === 'flat') {
      const el = this.el;
      const next = Math.max(1e-4, Math.min(1, this.flat.unitsPerPx * factor));
      if (el && clientX !== undefined && clientY !== undefined) {
        // Keep the world point under the cursor fixed.
        const r = el.getBoundingClientRect();
        const ox = clientX - r.left - r.width / 2;
        const oy = clientY - r.top - r.height / 2;
        const wx = this.flat.center[0] + ox * this.flat.unitsPerPx;
        const wy = this.flat.center[1] - oy * this.flat.unitsPerPx;
        this.flat.center = [wx - ox * next, wy + oy * next];
      }
      this.flat.unitsPerPx = next;
    } else {
      this.orbit.distance = Math.max(0.5, Math.min(80, this.orbit.distance * factor));
    }
    this.dirty = true;
  }

  /** Smoothly move to a camera state. */
  animateTo(to: CameraState, dur = 0.6) {
    this.anim = { from: structuredClone(this.orbit), to: structuredClone(to), t: 0, dur };
    this.dirty = true;
  }

  set(state: CameraState) {
    this.orbit = structuredClone(state);
    this.anim = null;
    this.dirty = true;
  }

  markDirty() {
    this.dirty = true;
  }

  /** Advance inertia/animations. Returns true if the view changed since the last call. */
  update(dt: number): boolean {
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt / a.dur);
      const u = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      const lerp = (x: number, y: number) => x + (y - x) * u;
      // Take the short way round in yaw.
      let dy = a.to.yaw - a.from.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.orbit = {
        yaw: a.from.yaw + dy * u,
        pitch: lerp(a.from.pitch, a.to.pitch),
        distance: lerp(a.from.distance, a.to.distance),
        target: [lerp(a.from.target[0], a.to.target[0]), lerp(a.from.target[1], a.to.target[1]), lerp(a.from.target[2], a.to.target[2])],
      };
      if (a.t >= 1) this.anim = null;
      this.dirty = true;
    } else if (!this.interacting && (Math.abs(this.velYaw) > 1e-5 || Math.abs(this.velPitch) > 1e-5)) {
      this.orbit.yaw += this.velYaw;
      this.orbit.pitch = Math.max(-1.52, Math.min(1.52, this.orbit.pitch + this.velPitch));
      const decay = Math.exp(-dt * 6);
      this.velYaw *= decay;
      this.velPitch *= decay;
      this.dirty = true;
    }
    const d = this.dirty;
    this.dirty = false;
    return d;
  }
}
