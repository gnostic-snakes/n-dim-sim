import { useEffect, useState } from 'react';
import type { FrameData } from '../scene/frame';
import { engine } from './engine';

/** The latest frame data from the render loop, refreshed at most every `ms` milliseconds. */
export function useFrame(ms = 120): FrameData | null {
  const [frame, setFrame] = useState<FrameData | null>(engine.frame);
  useEffect(() => {
    let last = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let latest: FrameData | null = null;
    const unsub = engine.subscribe((f, changed) => {
      if (!changed && f === latest) return;
      latest = f;
      const now = performance.now();
      if (now - last >= ms) {
        last = now;
        setFrame(f);
      } else if (!pending) {
        pending = setTimeout(
          () => {
            pending = null;
            last = performance.now();
            setFrame(latest);
          },
          ms - (now - last),
        );
      }
    });
    return () => {
      unsub();
      if (pending) clearTimeout(pending);
    };
  }, [ms]);
  return frame;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}
