import { useEffect, useRef } from 'react';
import { engine } from './engine';

/** The main slice view: a full-size canvas driven by the shared engine. */
export function Viewport() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    engine.mount(canvas);
    return () => engine.unmount();
  }, []);
  return <canvas ref={ref} className="viewport" aria-label="3D slice view. Drag to orbit, scroll to zoom, right-drag to pan." />;
}
