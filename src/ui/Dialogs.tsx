/** Help and glossary dialogs. */
import { useEffect, useRef } from 'react';
import { GLOSSARY } from './glossary';
import { IconButton } from './controls';
import { useUi } from './uiStore';

function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  const close = () => useUi.getState().setDialog(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <IconButton icon="close" hint="Close (Esc)" onClick={close} />
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function HelpDialog() {
  return (
    <Modal title="How Slice works">
      <p>
        Slice shows what a 3D being would see of a 4D (or higher-dimensional) shape: the <b>3D cross-section</b> where the shape meets our
        world. Think of a sphere passing through Flatland, which the Flatlanders see as a circle that grows and shrinks. Here the same thing
        happens one dimension up.
      </p>
      <h3>Try this first</h3>
      <p>
        Load <b>Presets → Tesseract: xw spin</b> and press play. The tesseract is turning in the <b>xw-plane</b>, which mixes our x-axis
        with the hidden w-axis, so the cube you see stretches and changes shape. Then add a rotation in <b>xy</b>: that one just spins the
        slice like an ordinary 3D object.
      </p>
      <h3>The pieces</h3>
      <p>
        <b>Transform stack</b> (left): rotations, translations and scales applied top to bottom. Drag rows to reorder them and watch the
        result change. <b>Slice</b> (right): where our world sits along each hidden axis. <b>Context view</b> (top right): the whole shape
        squashed into 3D, coloured blue/orange by hidden position, with the slice outlined. <b>Timeline</b> (bottom): click any ◆ to
        keyframe a value, move the playhead, change the value, press play.
      </p>
      <h3>Mouse and touch</h3>
      <p>
        Drag to orbit · scroll or pinch to zoom · right-drag, shift-drag or two fingers to pan. The camera is only your 3D eyes: it never
        changes the 4D shape. Number boxes can be dragged sideways to scrub, or clicked to type.
      </p>
      <h3>Keyboard</h3>
      <p>
        <kbd>Space</kbd> play/pause · <kbd>Home</kbd>/<kbd>End</kbd> jump to start/end · <kbd>←</kbd>/<kbd>→</kbd> step the playhead ·{' '}
        <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo · <kbd>F</kbd> reset the camera ·{' '}
        <kbd>1</kbd>–<kbd>4</kbd> shading modes · <kbd>Delete</kbd> removes the selected keyframe.
      </p>
      <h3>How it is drawn</h3>
      <p>
        Every pixel casts a ray through our 3D world. Points on the ray are lifted into n-D (with the hidden coordinates set to the slice
        offsets) and mapped back through the object’s transform. Flat-sided polytopes are cut exactly, face by face; curved shapes are
        ray-marched using a signed distance function. Nothing in the maths assumes 4 dimensions, which is why 5D to 8D and Flatland work
        too.
      </p>
    </Modal>
  );
}

export function GlossaryDialog() {
  return (
    <Modal title="Glossary">
      <dl className="glossary">
        {Object.entries(GLOSSARY).map(([key, g]) => (
          <div key={key}>
            <dt>{g.term}</dt>
            <dd>{g.text}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
