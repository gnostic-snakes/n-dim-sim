import { describe, expect, it } from 'vitest';
import { ease, editValue, evaluateTrack, pruneTracks, removeKey, resolveScene, setKey } from './animation';
import { changeDimension, defaultScene, makeOp, paths, readPath, writePath, type Keyframe } from './model';
import { decodeScene, encodeScene, sanitizeScene } from './persist';
import { PRESETS } from './presets';
import { computeFrame } from './frame';

const key = (t: number, v: number, e: Keyframe['ease'] = 'linear'): Keyframe => ({ id: `k${t}`, t, v, ease: e });

describe('animation', () => {
  it('interpolates tracks with easing and clamps outside the keys', () => {
    const keys = [key(1, 0), key(3, 10, 'ease'), key(5, 20, 'hold')];
    expect(evaluateTrack(keys, 0)).toBe(0);
    expect(evaluateTrack(keys, 2)).toBeCloseTo(5);
    expect(evaluateTrack(keys, 4)).toBeCloseTo(15); // ease in-out is symmetric at the midpoint
    expect(evaluateTrack(keys, 3.5)).toBeLessThan(12.5);
    expect(evaluateTrack(keys, 9)).toBe(20);
    expect(ease('hold', 0.99)).toBe(0);
    expect(ease('ease-in', 0.5)).toBeLessThan(0.5);
    expect(ease('ease-out', 0.5)).toBeGreaterThan(0.5);
  });

  it('edits static values directly and animated values via keyframes', () => {
    let s = defaultScene(4);
    const obj = s.objects[0];
    const path = paths.op(obj.id, obj.ops[0].id);
    s = editValue(s, path, 2, 45);
    expect(readPath(s, path)).toBe(45);
    s = setKey(s, path, 0, 0);
    s = editValue(s, path, 4, 90); // animated now: adds a key
    expect(s.timeline.tracks[path].map((k) => [k.t, k.v])).toEqual([
      [0, 0],
      [4, 90],
    ]);
    expect(readPath(resolveScene(s, 2), path)).toBeCloseTo(45);
    const removed = removeKey(s, path, s.timeline.tracks[path][0].id);
    expect(removed.timeline.tracks[path]).toHaveLength(1);
  });

  it('drops tracks whose targets disappear', () => {
    let s = defaultScene(4);
    const obj = s.objects[0];
    const path = paths.op(obj.id, obj.ops[0].id);
    s = setKey(s, path, 0, 10);
    s = { ...s, objects: s.objects.map((o) => ({ ...o, ops: [] })) };
    expect(pruneTracks(s).timeline.tracks[path]).toBeUndefined();
  });
});

describe('model', () => {
  it('reads and writes values by path', () => {
    const s = defaultScene(5);
    const s2 = writePath(s, paths.slice(1), 0.75);
    expect(readPath(s2, paths.slice(1))).toBe(0.75);
    expect(readPath(s, paths.slice(1))).toBe(0);
  });

  it('changes dimension while keeping things sensible', () => {
    let s = defaultScene(4);
    s = { ...s, objects: s.objects.map((o) => ({ ...o, shape: 'cell24', ops: [...o.ops, makeOp('translate', { axis: 3, value: 1 })] })) };
    const s3 = changeDimension(s, 3);
    expect(s3.slice).toHaveLength(1);
    expect(s3.objects[0].shape).toBe('cross');
    for (const op of s3.objects[0].ops) {
      if (op.kind === 'rotate') expect(Math.max(...op.plane)).toBeLessThan(3);
      else expect(op.axis).toBeLessThan(3);
    }
    const s6 = changeDimension(s, 6);
    expect(s6.slice).toHaveLength(3);
    expect(s6.objects[0].shape).toBe('cross');
  });
});

describe('persistence', () => {
  it('round-trips through the share-link encoding', async () => {
    const s = PRESETS.find((p) => p.id === 'tesseract-diagonal')!.build();
    const code = await encodeScene(s);
    expect(code.length).toBeLessThan(2000);
    const back = await decodeScene(code);
    expect(back.dim).toBe(4);
    expect(back.objects[0].ops.map((o) => o.value)).toEqual(s.objects[0].ops.map((o) => o.value));
    expect(back.timeline.tracks).toEqual(s.timeline.tracks);
  });

  it('sanitizes hostile or broken input', () => {
    expect(() => sanitizeScene(null)).toThrow();
    expect(() => sanitizeScene({ objects: [{ shape: 'nope' }] })).toThrow();
    const s = sanitizeScene({
      dim: 99,
      slice: ['x', 1e9],
      objects: [
        {
          id: 'a',
          shape: 'hypercube',
          params: { size: 'big' },
          ops: [{ kind: 'rotate', plane: [7, 7], value: 30 }, { kind: 'explode' }, { kind: 'scale', axis: 2, value: 0 }],
          color: 'javascript:alert(1)',
        },
        { id: 'a', shape: 'ball', params: { r: 2 } },
      ],
      timeline: { duration: -5, tracks: { 'obj.a.param.size': [{ t: 1, v: 3, ease: 'bogus' }], junk: 'x' } },
      view: { shading: 'evil', ghost: { mode: 'side' } },
    });
    expect(s.dim).toBe(8);
    expect(s.slice).toHaveLength(5);
    expect(s.slice[0]).toBe(0);
    expect(s.objects).toHaveLength(2);
    expect(new Set(s.objects.map((o) => o.id)).size).toBe(2);
    expect(s.objects[0].params.size).toBe(2);
    expect(s.objects[0].ops).toHaveLength(2);
    expect(s.objects[0].ops[0].plane[0]).not.toBe(s.objects[0].ops[0].plane[1]);
    expect(s.objects[0].ops[1].value).toBeGreaterThan(0);
    expect(s.objects[0].color).toBe('#f2a65a');
    expect(s.timeline.duration).toBe(0.5);
    expect(s.timeline.tracks['obj.a.param.size'][0].ease).toBe('ease');
    expect(s.view.shading).toBe('cells');
    expect(s.view.ghost.mode).toBe('side');
  });
});

describe('presets', () => {
  for (const p of PRESETS) {
    it(`"${p.title}" builds a valid scene with visible content`, () => {
      const s = p.build();
      expect(sanitizeScene(JSON.parse(JSON.stringify(s)))).toBeTruthy();
      for (const path of Object.keys(s.timeline.tracks)) expect(readPath(s, path)).not.toBeUndefined();
      // Something is visible at some point of the animation.
      let visible = false;
      for (let t = 0; t <= s.timeline.duration; t += s.timeline.duration / 8) {
        const f = computeFrame(resolveScene(s, t));
        if (f.objects.some((o) => o.visible)) visible = true;
      }
      expect(visible).toBe(true);
    });
  }
});
