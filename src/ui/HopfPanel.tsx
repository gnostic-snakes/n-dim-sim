/** Controls and explanation for the Hopf fibration view. */
import { useEffect, useRef } from 'react';
import { hopfBasePoints } from '../render/hopfRenderer';
import { IconButton, NumberField, PopButton, Term } from './controls';
import { engine } from './engine';
import { Icon } from './icons';
import { PlaneLabel, PlanePicker } from './TransformStack';
import { closeSpecial } from './TopBar';
import { useUi } from './uiStore';

function Slider({
  label,
  value,
  min,
  max,
  step,
  digits = 0,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="label" style={{ color: 'var(--text-2)', marginBottom: 2 }}>
        {label}
      </div>
      <div className="value-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) 62px' }}>
        <input
          className="slider"
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          style={{ ['--pct' as string]: `${pct}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <NumberField label={label} value={value} step={step} digits={digits} suffix={suffix} min={min} max={max} onChange={onChange} />
      </div>
    </div>
  );
}

export function HopfControls() {
  const h = useUi((s) => s.hopf);
  const set = useUi((s) => s.setHopf);
  return (
    <>
      <div className="section">
        <div className="section-title">
          Hopf fibration <span className="grow" />
          <button className="btn small" onClick={closeSpecial}>
            Back to slices
          </button>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          A special view rather than a slice: every circle here is a whole <b>great circle of the 3-sphere</b>, brought into our space by
          stereographic projection.
        </p>
      </div>
      <div className="section">
        <div className="section-title">Fibers</div>
        <Slider
          label="Latitude bands on the base sphere"
          value={h.bands}
          min={1}
          max={7}
          step={1}
          onChange={(v) => set({ bands: Math.round(v) })}
        />
        <Slider label="Circles per band" value={h.perBand} min={3} max={36} step={1} onChange={(v) => set({ perBand: Math.round(v) })} />
        <Slider
          label="Tube thickness"
          value={h.thickness}
          min={0.005}
          max={0.1}
          step={0.001}
          digits={3}
          onChange={(v) => set({ thickness: v })}
        />
      </div>
      <div className="section">
        <div className="section-title">4D rotation</div>
        <div className="row">
          <span className="label">Plane</span>
          <PopButton className="plane-btn" label={<PlaneLabel plane={h.plane} />} hint="Choose the 4D rotation plane">
            {(close) => (
              <PlanePicker
                n={4}
                value={h.plane}
                onPick={(p) => {
                  set({ plane: p });
                  close();
                }}
              />
            )}
          </PopButton>
          <span style={{ flex: 1 }} />
          <IconButton
            icon={h.playing ? 'pause' : 'play'}
            hint={h.playing ? 'Pause' : 'Play'}
            className="btn primary icon"
            onClick={() => set({ playing: !h.playing })}
          />
        </div>
        <Slider
          label="Angle"
          value={(h.angle * 180) / Math.PI}
          min={0}
          max={360}
          step={1}
          suffix="°"
          onChange={(v) => set({ angle: (v * Math.PI) / 180, playing: false })}
        />
        <Slider label="Speed" value={h.speed} min={-90} max={90} step={1} suffix="°/s" onChange={(v) => set({ speed: v })} />
        <p className="hint">
          Rotating the 3-sphere moves the circles around, but they never pass through each other and every pair stays linked.
        </p>
      </div>
    </>
  );
}

/** The base 2-sphere with the chosen points, coloured like their fibers. */
function BaseSphere() {
  const ref = useRef<HTMLCanvasElement>(null);
  const bands = useUi((s) => s.hopf.bands);
  const perBand = useUi((s) => s.hopf.perBand);
  useEffect(() => {
    const canvas = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth * dpr;
    const H = canvas.clientHeight * dpr;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const yaw = engine.camera.orbit.yaw;
      const tilt = 0.45;
      const R = Math.min(W, H) * 0.4;
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const grad = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
      grad.addColorStop(0, 'rgba(70,82,110,0.55)');
      grad.addColorStop(1, 'rgba(20,24,36,0.55)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,170,190,0.35)';
      ctx.lineWidth = dpr;
      ctx.stroke();
      const project = (theta: number, phi: number) => {
        const x = Math.sin(theta) * Math.cos(phi + yaw);
        const y = Math.cos(theta);
        const z = Math.sin(theta) * Math.sin(phi + yaw);
        const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
        const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
        return { x: cx + x * R, y: cy - y2 * R, z: z2 };
      };
      const pts = hopfBasePoints(bands, perBand).map((b) => ({ ...project(b.theta, b.phi), color: b.color }));
      pts.sort((a, b) => a.z - b.z);
      for (const p of pts) {
        const front = p.z > 0;
        ctx.globalAlpha = front ? 1 : 0.35;
        ctx.fillStyle = `rgb(${p.color.map((c) => Math.round(c * 255)).join(',')})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (front ? 3.2 : 2.4) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [bands, perBand]);
  return (
    <canvas ref={ref} style={{ width: '100%', height: 170, display: 'block' }} aria-label="The base 2-sphere with one dot per circle" />
  );
}

export function HopfInfo() {
  return (
    <>
      <div className="section">
        <div className="section-title">The base sphere</div>
        <BaseSphere />
        <p className="hint">
          Each dot on this ordinary sphere has one circle over it, in the same colour. Dots on one line of latitude give circles that sweep
          out a torus, and the tori nest inside each other.
        </p>
      </div>
      <div className="section">
        <div className="section-title">What am I looking at?</div>
        <div className="desc">
          <p style={{ marginTop: 0 }}>
            The <b>3-sphere</b> is the 3D surface of a 4D ball, the boundary of the <Term k="dimension">4D</Term> hypersphere. The Hopf
            fibration splits it completely into circles, one for every point of an ordinary 2-sphere, with no two circles touching.
          </p>
          <p>
            To show it we use <b>stereographic projection</b>, the 4D version of how a flat map shows a globe: one point of the 3-sphere
            goes off to infinity, and the rest spreads out over all of 3D space. Circles stay circles.
          </p>
          <p style={{ marginBottom: 0 }}>
            Look closely: <b>every pair of circles is linked</b>, like two links of a chain. The circles over a line of latitude are the
            Villarceau circles of a torus, and nested tori fill all of space.
          </p>
        </div>
        <div className="fun">
          <b>Did you know?</b> Heinz Hopf found this in 1931. It was the first example of a map from a sphere to a lower-dimensional sphere
          that cannot be continuously shrunk to a point, a surprise that helped found modern topology.
        </div>
      </div>
    </>
  );
}

export function HopfBadge() {
  const count = useUi((s) => s.hopf.bands * s.hopf.perBand);
  return (
    <div className="overlay hud">
      <div className="hud-chip">
        <Icon name="sparkles" size={12} /> <b>Hopf fibration</b> · {count} linked circles · drag to orbit
      </div>
    </div>
  );
}
