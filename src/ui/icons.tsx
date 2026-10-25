/** Minimal inline SVG icon set (24x24 stroke icons). */
const PATHS: Record<string, string> = {
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z',
  start: 'M6 5v14M18 5L9 12l9 7z',
  loop: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  rotate: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  scale: 'M4 20L20 4M14 4h6v6M10 20H4v-6',
  diamond: 'M12 2.5l9.5 9.5-9.5 9.5L2.5 12z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  upload: 'M12 21V9M7 14l5-5 5 5M4 3h16',
  record: 'M12 12m-7 0a7 7 0 1 0 14 0 7 7 0 1 0-14 0',
  stop: 'M6 6h12v12H6z',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  layers: 'M12 2l10 6-10 6L2 8zM2 16l10 6 10-6M2 12l10 6 10-6',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  film: 'M4 3h16v18H4zM8 3v18M16 3v18M4 8h4M4 16h4M16 8h4M16 16h4M4 12h16',
  frame: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  swap: 'M7 4v16M7 20l-4-4M7 20l4-4M17 20V4M17 4l-4 4M17 4l4 4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, filled = false, title }: { name: IconName; size?: number; filled?: boolean; title?: string }) {
  const solid = filled || name === 'play' || name === 'pause' || name === 'record' || name === 'stop';
  return (
    <svg
      className="icon-svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={solid ? { fill: 'currentColor', strokeWidth: name === 'record' ? 0 : 1.2 } : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
