import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { api, type Annotation } from './api';
import { useAssets } from './fields';

/*
 * Coordinates stay in source-image pixels, the same units the file stores.
 * Boxes are clamped to the image, so the build's out-of-bounds error is
 * unreachable from here.
 */

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];

/** Largest on-screen width for the editing surface. */
const MAX_DISPLAY_WIDTH = 900;

type Drag =
  | { kind: 'draw'; startX: number; startY: number }
  | { kind: 'move'; index: number; grabX: number; grabY: number }
  | { kind: 'resize'; index: number }
  | { kind: 'label'; index: number };

const isVertical = (side: Side): boolean => side === 'left' || side === 'right';

/** Whether a label at this point can be reached by a leader leaving that face. */
function reachable(a: Annotation, at: { x: number; y: number }, side: Side): boolean {
  switch (side) {
    case 'right':
      return at.x >= a.x + a.width;
    case 'left':
      return at.x <= a.x;
    case 'bottom':
      return at.y >= a.y + a.height;
    case 'top':
      return at.y <= a.y;
  }
}

/**
 * Dragging a label past the highlight makes its side impossible, and the build
 * would reject it. Turn to whichever face now points at the label, preferring
 * the axis it is furthest along. A side that still works is left alone, so an
 * explicit choice survives every drag that does not contradict it.
 */
function sideFor(a: Annotation, at: { x: number; y: number }, current: Side): Side {
  if (reachable(a, at, current)) return current;
  const dx = at.x - (a.x + a.width / 2);
  const dy = at.y - (a.y + a.height / 2);
  const byDistance: Side[] =
    Math.abs(dx) >= Math.abs(dy)
      ? [dx >= 0 ? 'right' : 'left', dy >= 0 ? 'bottom' : 'top']
      : [dy >= 0 ? 'bottom' : 'top', dx >= 0 ? 'right' : 'left'];
  return byDistance.find((s) => reachable(a, at, s)) ?? current;
}

export function AnnotationEditor({
  src,
  annotations,
  onChange,
}: {
  src: string | undefined;
  annotations: Annotation[];
  onChange: (next: Annotation[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const assets = useAssets();

  if (!src) {
    return (
      <>
        <h2 className="section-title">Annotations</h2>
        <p className="hint">Choose an image first.</p>
      </>
    );
  }

  // SVGs (and anything else with no readable header) are listed without a size,
  // and annotation coordinates are resolved against real pixels — so a vector
  // asset cannot be annotated. Caught here, the build's dimension error never
  // reaches the user. `undefined` means the list has not loaded yet, so only a
  // positively-known sizeless asset is blocked.
  const asset = assets.find((a) => a.path === src);
  if (asset && !(asset.width && asset.height)) {
    return (
      <>
        <h2 className="section-title">Annotations</h2>
        <p className="hint">
          <strong>{src}</strong> is a vector asset with no pixel size, so it cannot be annotated.
          Callout coordinates need a raster image — choose a PNG or JPEG screenshot to annotate.
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="section-title">Annotations</h2>

      {annotations.length === 0 ? (
        <p className="hint">
          None yet. Crop the screenshot tight before annotating — a detail that is only a few
          pixels wide in the rendered image cannot be rescued by highlighting it.
        </p>
      ) : (
        <ul className="filelist" style={{ marginBottom: 8 }}>
          {annotations.map((a, i) => (
            <li key={i} className="preview-caption" style={{ padding: '3px 0' }}>
              {a.x},{a.y} {a.width}×{a.height} · {a.side}
              {a.at && ` @${a.at.x},${a.at.y}`} · {a.text || '(no text)'}
            </li>
          ))}
        </ul>
      )}

      <button onClick={() => setOpen(true)}>
        {annotations.length ? 'Edit regions' : 'Draw regions'}
      </button>

      {open && (
        <AnnotationCanvas
          src={src}
          annotations={annotations}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AnnotationCanvas({
  src,
  annotations,
  onChange,
  onClose,
}: {
  src: string;
  annotations: Annotation[];
  onChange: (next: Annotation[]) => void;
  onClose: () => void;
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(annotations.length ? 0 : null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const scale = natural ? Math.min(1, MAX_DISPLAY_WIDTH / natural.w) : 1;

  /** Pointer position in source-image pixels, clamped to the image. */
  function toSource(e: ReactPointerEvent | PointerEvent): { x: number; y: number } {
    const rect = surface.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    if (!natural) return { x, y };
    return {
      x: Math.round(Math.max(0, Math.min(natural.w, x))),
      y: Math.round(Math.max(0, Math.min(natural.h, y))),
    };
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (!natural) return;
    capturePointer(e);
    const p = toSource(e);
    setSelected(null);
    setDrag({ kind: 'draw', startX: p.x, startY: p.y });
    setDraft({ x: p.x, y: p.y, width: 0, height: 0, text: '', side: 'right' });
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!drag || !natural) return;
    const p = toSource(e);

    if (drag.kind === 'draw') {
      setDraft({
        x: Math.min(p.x, drag.startX),
        y: Math.min(p.y, drag.startY),
        width: Math.abs(p.x - drag.startX),
        height: Math.abs(p.y - drag.startY),
        text: '',
        side: 'right',
      });
      return;
    }

    const current = annotations[drag.index];
    if (!current) return;

    if (drag.kind === 'move') {
      const next = [...annotations];
      next[drag.index] = {
        ...current,
        x: clamp(p.x - drag.grabX, 0, natural.w - current.width),
        y: clamp(p.y - drag.grabY, 0, natural.h - current.height),
      };
      onChange(next);
      return;
    }

    if (drag.kind === 'label') {
      const at = snapOutside(current, {
        x: clamp(p.x, 0, natural.w),
        y: clamp(p.y, 0, natural.h),
      });
      const next = [...annotations];
      next[drag.index] = { ...current, at, side: sideFor(current, at, current.side) };
      onChange(next);
      return;
    }

    // resize from the bottom-right corner
    const next = [...annotations];
    next[drag.index] = {
      ...current,
      width: clamp(p.x - current.x, 1, natural.w - current.x),
      height: clamp(p.y - current.y, 1, natural.h - current.y),
    };
    onChange(next);
  }

  function onPointerUp() {
    if (drag?.kind === 'draw' && draft) {
      // Ignore stray clicks that did not sweep a usable area.
      if (draft.width >= 4 && draft.height >= 4) {
        onChange([...annotations, { ...draft, text: 'New label' }]);
        setSelected(annotations.length);
      }
    }
    setDrag(null);
    setDraft(null);
  }

  function update(index: number, patch: Partial<Annotation>) {
    const next = [...annotations];
    next[index] = { ...next[index]!, ...patch };
    onChange(next);
  }

  /** Arrow keys nudge by one source pixel, for targets a drag cannot hit exactly. */
  function onKeyDown(e: React.KeyboardEvent) {
    if (selected === null || !natural) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
      e.key
    ];
    if (!delta) return;
    e.preventDefault();
    const a = annotations[selected]!;
    update(selected, {
      x: clamp(a.x + delta[0]!, 0, natural.w - a.width),
      y: clamp(a.y + delta[1]!, 0, natural.h - a.height),
    });
  }

  const active = selected !== null ? annotations[selected] : undefined;

  return (
    <div className="modal" onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="modal__panel">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong>Annotation regions</strong>
          <span className="preview-caption">
            {natural ? `${natural.w}×${natural.h} source px` : 'loading…'}
            {scale < 1 && ` · shown at ${Math.round(scale * 100)}%`}
          </span>
          <div className="spacer" />
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>

        <p className="hint" style={{ marginBottom: 8 }}>
          Drag on the image to draw a region. Click one to select it, drag to move, use the corner
          handle to resize, or nudge with the arrow keys. Drag a label anywhere on the image — the
          leader follows with an elbow, and the side turns to face it if you cross the region.
        </p>

        <div className="modal__scroll">
          <div
            ref={surface}
            className="anno-surface"
            style={{ width: natural ? natural.w * scale : undefined }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <img
              src={api.assetUrl(src)}
              alt=""
              draggable={false}
              onLoad={(e) =>
                setNatural({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
              style={{ width: natural ? natural.w * scale : 'auto', display: 'block' }}
            />

            {annotations.map((a, i) => (
              <div
                key={i}
                className={`anno-rect${selected === i ? ' is-selected' : ''}`}
                style={{
                  left: a.x * scale,
                  top: a.y * scale,
                  width: a.width * scale,
                  height: a.height * scale,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  capturePointer(e);
                  const p = toSource(e);
                  setSelected(i);
                  setDrag({ kind: 'move', index: i, grabX: p.x - a.x, grabY: p.y - a.y });
                }}
              >
                <span
                  className="anno-rect__handle"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    capturePointer(e);
                    setSelected(i);
                    setDrag({ kind: 'resize', index: i });
                  }}
                />
              </div>
            ))}

            {/* Pinned and offset like the rendered label, so collisions show here. */}
            {natural &&
              annotations.map((a, i) => (
                <div
                  key={`label-${i}`}
                  className={`anno-label${selected === i ? ' is-selected' : ''}`}
                  style={{
                    ...labelStyle(a, natural, scale),
                    cursor: 'move',
                  }}
                  title="Drag to place the label anywhere"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    capturePointer(e);
                    setSelected(i);
                    setDrag({ kind: 'label', index: i });
                  }}
                >
                  {a.text || '(no text)'}
                </div>
              ))}

            {draft && draft.width > 0 && (
              <div
                className="anno-rect is-draft"
                style={{
                  left: draft.x * scale,
                  top: draft.y * scale,
                  width: draft.width * scale,
                  height: draft.height * scale,
                }}
              />
            )}
          </div>
        </div>

        {/* Fixed height: a resizing panel would move the image mid-drag. */}
        <div className="anno-detail">
        {active && selected !== null ? (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="field">
              <label>Label text</label>
              <input
                type="text"
                value={active.text}
                onChange={(e) => update(selected, { text: e.target.value })}
              />
            </div>

            <div className="field">
              <label>Label side</label>
              <div className="row">
                {SIDES.map((side) => (
                  <button
                    key={side}
                    aria-pressed={active.side === side}
                    className={active.side === side ? 'primary' : ''}
                    // A side the label cannot be reached from would fail the
                    // build, so offer only the ones its position allows.
                    disabled={!!active.at && !reachable(active, active.at, side)}
                    onClick={() => update(selected, { side: side as Side })}
                  >
                    {side}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Label position</label>
              <div className="row">
                <input
                  type="number"
                  value={active.at ? active.at.x : ''}
                  placeholder="x"
                  disabled={!active.at}
                  onChange={(e) =>
                    update(selected, { at: { ...active.at!, x: Number(e.target.value) } })
                  }
                  style={{ width: 80 }}
                />
                <input
                  type="number"
                  value={active.at ? active.at.y : ''}
                  placeholder="y"
                  disabled={!active.at}
                  onChange={(e) =>
                    update(selected, { at: { ...active.at!, y: Number(e.target.value) } })
                  }
                  style={{ width: 80 }}
                />
                <span className="preview-caption">
                  {active.at ? 'source px' : 'pinned to the edge'}
                </span>
                <div className="spacer" />
                <button disabled={!active.at} onClick={() => update(selected, { at: undefined })}>
                  Pin to edge
                </button>
              </div>
            </div>

            <div className="row">
              <span className="preview-caption">
                {active.x},{active.y} · {active.width}×{active.height}
              </span>
              <div className="spacer" />
              <button
                className="danger"
                onClick={() => {
                  onChange(annotations.filter((_, j) => j !== selected));
                  setSelected(null);
                }}
              >
                Delete region
              </button>
            </div>
          </div>
        ) : (
          <p className="hint" style={{ marginTop: 12 }}>
            No region selected.
          </p>
        )}
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, v)));
}

/** An anchor inside the highlight has no reachable side; push it out the nearest face. */
function snapOutside(a: Annotation, at: { x: number; y: number }): { x: number; y: number } {
  const sides: Side[] = ['right', 'left', 'bottom', 'top'];
  if (sides.some((s) => reachable(a, at, s))) return at;

  const gaps = [
    { d: at.x - a.x, out: { ...at, x: a.x } },
    { d: a.x + a.width - at.x, out: { ...at, x: a.x + a.width } },
    { d: at.y - a.y, out: { ...at, y: a.y } },
    { d: a.y + a.height - at.y, out: { ...at, y: a.y + a.height } },
  ];
  return gaps.reduce((best, g) => (g.d < best.d ? g : best)).out;
}

/** Mirrors the renderer: anchored where the leader lands, or pinned to the border. */
function labelStyle(a: Annotation, n: { w: number; h: number }, scale: number): CSSProperties {
  const inset = 8;

  if (!a.at) {
    const along = (isVertical(a.side) ? a.y + a.height / 2 : a.x + a.width / 2) * scale;
    switch (a.side) {
      case 'right':
        return { top: along, right: inset, transform: 'translateY(-50%)' };
      case 'left':
        return { top: along, left: inset, transform: 'translateY(-50%)' };
      case 'top':
        return { left: along, top: inset, transform: 'translateX(-50%)' };
      case 'bottom':
        return { left: along, bottom: inset, transform: 'translateX(-50%)' };
    }
  }

  const x = a.at.x * scale;
  const y = a.at.y * scale;
  switch (a.side) {
    case 'right':
      return { left: x, top: y, transform: 'translateY(-50%)' };
    case 'left':
      return { right: (n.w - a.at.x) * scale, top: y, transform: 'translateY(-50%)' };
    case 'top':
      return { left: x, bottom: (n.h - a.at.y) * scale, transform: 'translateX(-50%)' };
    case 'bottom':
      return { left: x, top: y, transform: 'translateX(-50%)' };
  }
}

/**
 * Keeps a drag alive outside the element. Throws if the pointer is already
 * released, which must not abort the drag setup that follows.
 */
function capturePointer(e: ReactPointerEvent): void {
  try {
    (e.target as Element).setPointerCapture?.(e.pointerId);
  } catch {
    /* Drag still works without capture; it just ends if the pointer leaves. */
  }
}
