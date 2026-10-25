/** Left panel: the objects in the scene, the selected object's shape, and its transform stack. */
import { useEffect } from 'react';
import { pruneTracks } from '../scene/animation';
import { makeObject, makeOp, OBJECT_COLORS, paths, type SceneObject } from '../scene/model';
import { useApp } from '../scene/store';
import { defaultOptions, defaultParams, getShape, shapesForDim } from '../shapes/registry';
import type { ShapeCategory } from '../shapes/types';
import { IconButton, NumberField, PopButton, Term, ValueSlider } from './controls';
import { Icon } from './icons';
import { OrderLesson } from './OrderLesson';
import { TransformStack } from './TransformStack';
import { useUi } from './uiStore';

const CATEGORY_LABEL: Record<ShapeCategory, string> = {
  regular: 'Regular 4D polytopes',
  family: 'Families (any dimension)',
  prism: 'Prisms',
  curved: 'Curved shapes',
  flatland: '3D shapes',
};
const CATEGORY_ORDER: ShapeCategory[] = ['family', 'regular', 'prism', 'curved', 'flatland'];

/** Keeps every scene within the renderer's per-kind limits (8 polytopes, 6 curved shapes). */
export const MAX_OBJECTS = 6;

export function objectName(obj: SceneObject, n: number): string {
  if (obj.label) return obj.label;
  const def = getShape(obj.shape);
  return def.name(n, obj.options);
}

function ShapeMenu({ n, onPick }: { n: number; onPick: (id: string) => void }) {
  const shapes = shapesForDim(n);
  return (
    <div className="menu" role="menu">
      {CATEGORY_ORDER.map((cat) => {
        const list = shapes.filter((s) => s.category === cat);
        if (list.length === 0) return null;
        return (
          <div key={cat}>
            <div className="menu-group">{CATEGORY_LABEL[cat]}</div>
            {list.map((s) => (
              <button key={s.id} className="menu-item" role="menuitem" onClick={() => onPick(s.id)}>
                {s.name(n, defaultOptions(s))}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ObjectList() {
  const scene = useApp((s) => s.scene);
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const setScene = useApp((s) => s.setScene);
  const n = scene.dim;
  const add = (shape: string) => {
    const count = scene.objects.length;
    if (count >= MAX_OBJECTS) {
      useApp.getState().notify(`A scene can hold up to ${MAX_OBJECTS} shapes`);
      return;
    }
    const obj = makeObject(shape, {
      color: OBJECT_COLORS[count % OBJECT_COLORS.length],
      ops: [
        makeOp('rotate', { plane: n >= 4 ? [0, 3] : [1, 2], value: 0 }),
        ...(count > 0 ? [makeOp('translate', { axis: 0, value: 3.2 * count })] : []),
      ],
    });
    setScene((s) => ({ ...s, objects: [...s.objects, obj] }));
    select(obj.id);
  };
  return (
    <div className="section">
      <div className="section-title">
        Objects <span className="grow" />
        <PopButton
          className="btn small"
          label={
            <>
              <Icon name="plus" size={14} /> Add
            </>
          }
          hint="Add another shape to the scene"
        >
          {(close) => (
            <ShapeMenu
              n={n}
              onPick={(id) => {
                add(id);
                close();
              }}
            />
          )}
        </PopButton>
      </div>
      <div className="obj-list" role="listbox" aria-label="Objects">
        {scene.objects.map((o) => (
          <div
            key={o.id}
            className={`obj-item${o.id === selectedId ? ' selected' : ''}`}
            role="option"
            aria-selected={o.id === selectedId}
            tabIndex={0}
            onClick={() => select(o.id)}
            onKeyDown={(e) => e.key === 'Enter' && select(o.id)}
          >
            <span className="swatch" style={{ background: o.color }} />
            <span className="name">{objectName(o, n)}</span>
            {/* Buttons inside the row must not also select the row. */}
            <span style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()}>
              <IconButton
                icon={o.visible ? 'eye' : 'eyeOff'}
                hint={o.visible ? 'Hide' : 'Show'}
                className="btn ghost small icon"
                size={14}
                onClick={() =>
                  setScene((s) => ({ ...s, objects: s.objects.map((x) => (x.id === o.id ? { ...x, visible: !x.visible } : x)) }))
                }
              />
              {scene.objects.length > 1 && (
                <IconButton
                  icon="trash"
                  hint="Delete object"
                  className="btn ghost small icon"
                  size={14}
                  onClick={() => {
                    setScene((s) => ({ ...s, objects: s.objects.filter((x) => x.id !== o.id) }));
                    if (selectedId === o.id) select(scene.objects.find((x) => x.id !== o.id)?.id ?? null);
                  }}
                />
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShapeEditor({ obj }: { obj: SceneObject }) {
  const n = useApp((s) => s.scene.dim);
  const setScene = useApp((s) => s.setScene);
  const def = getShape(obj.shape);
  const updateObj = (patch: Partial<SceneObject>, coalesce?: string) =>
    setScene(
      (s) => ({ ...s, objects: s.objects.map((o) => (o.id === obj.id ? { ...o, ...patch } : o)) }),
      coalesce ? { coalesce } : undefined,
    );
  const changeShape = (id: string) => {
    const d = getShape(id);
    setScene((s) =>
      pruneTracks({
        ...s,
        objects: s.objects.map((o) =>
          o.id === obj.id ? { ...o, shape: id, params: defaultParams(d), options: defaultOptions(d), label: undefined } : o,
        ),
      }),
    );
  };
  return (
    <div className="section">
      <div className="section-title">Shape</div>
      <div className="row">
        <PopButton
          className="btn"
          label={
            <>
              {def.name(n, obj.options)} <Icon name="chevronDown" size={14} />
            </>
          }
          hint="Change shape"
        >
          {(close) => (
            <ShapeMenu
              n={n}
              onPick={(id) => {
                changeShape(id);
                close();
              }}
            />
          )}
        </PopButton>
        <span className="grow" style={{ flex: 1 }} />
        <input
          type="color"
          className="color-input"
          aria-label="Object colour"
          value={obj.color}
          onChange={(e) => updateObj({ color: e.target.value }, `color:${obj.id}`)}
        />
      </div>
      {(def.options ?? []).map((o) => (
        <div className="row" key={o.key}>
          <span className="label" title={o.label}>
            {o.label}
          </span>
          <div style={{ width: 80 }}>
            <NumberField
              label={o.label}
              value={obj.options[o.key] ?? o.default}
              step={1}
              digits={0}
              min={o.min}
              max={o.max}
              onChange={(v) => updateObj({ options: { ...obj.options, [o.key]: Math.round(v) } }, `opt:${obj.id}:${o.key}`)}
            />
          </div>
        </div>
      ))}
      {def.params.map((p) => (
        <div key={p.key} style={{ marginTop: 8 }}>
          <div className="label" style={{ color: 'var(--text-2)', marginBottom: 2 }} title={p.hint}>
            {p.key === 'size' ? <Term k="circumradius">Size</Term> : p.label}
          </div>
          <ValueSlider path={paths.param(obj.id, p.key)} label={p.label} min={p.min} max={p.max} step={p.step} hardMin={p.min * 0.01} />
        </div>
      ))}
    </div>
  );
}

export function ScenePanel() {
  const lesson = useUi((s) => s.lesson);
  const scene = useApp((s) => s.scene);
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const obj = scene.objects.find((o) => o.id === selectedId) ?? scene.objects[0];
  useEffect(() => {
    if (obj && obj.id !== selectedId) select(obj.id);
  }, [obj, selectedId, select]);
  return (
    <>
      {lesson === 'order' && <OrderLesson />}
      <ObjectList />
      {obj && (
        <>
          <ShapeEditor obj={obj} />
          <div className="section">
            <div className="section-title">
              <Term k="transformStack">Transform stack</Term>
            </div>
            <TransformStack obj={obj} />
          </div>
        </>
      )}
    </>
  );
}
