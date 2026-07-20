import type { Annotation, BodyItem, Content } from './api';
import { Area, AssetPicker, Check, Num, Select, Text } from './fields';
import { AnnotationEditor } from './AnnotationEditor';
import { GenericForm } from './GenericForm';
import { useTypeInfo } from './schema';

/** Schema-driven forms, one per content type. */

type Patch = (draft: Record<string, unknown>) => void;

export function ContentForm({
  value,
  onChange,
}: {
  value: Content;
  onChange: (next: Content) => void;
}) {
  const info = useTypeInfo(value.type);

  const edit = (patch: Patch) => {
    const next = structuredClone(value) as Record<string, unknown>;
    patch(next);
    onChange(next as Content);
  };

  const s = (key: string) => value[key] as string | undefined;

  switch (value.type) {
    case 'banner':
      return (
        <>
          <Text label="Title" value={s('title')} onChange={(v) => edit((d) => (d['title'] = v))} />
          <Text
            label="Kicker"
            value={s('kicker')}
            hint="Optional monospace text, right-aligned."
            onChange={(v) => edit((d) => (d['kicker'] = v))}
          />
        </>
      );

    case 'block':
      return (
        <>
          <Text label="Title" value={s('title')} onChange={(v) => edit((d) => (d['title'] = v))} />
          <BodyEditor
            items={(value['body'] as BodyItem[]) ?? []}
            onChange={(items) => edit((d) => (d['body'] = items))}
          />
        </>
      );

    case 'card':
      return (
        <>
          <Text
            label="Eyebrow"
            value={s('eyebrow')}
            hint="Small accent line above the title, e.g. “Requires Biotech”."
            onChange={(v) => edit((d) => (d['eyebrow'] = v))}
          />
          <Text label="Title" value={s('title')} onChange={(v) => edit((d) => (d['title'] = v))} />
          <AssetPicker
            label="Icon"
            value={s('icon')}
            onChange={(v) => edit((d) => (d['icon'] = v))}
          />
          <BodyEditor
            items={(value['body'] as BodyItem[]) ?? []}
            onChange={(items) => edit((d) => (d['body'] = items))}
          />
        </>
      );

    case 'preview-title':
      return (
        <>
          <Text label="Name" value={s('name')} onChange={(v) => edit((d) => (d['name'] = v))} />
          <Area
            label="Tagline"
            value={s('tagline') ?? ''}
            rows={2}
            onChange={(v) => edit((d) => (d['tagline'] = v === '' ? undefined : v))}
          />
          <Text label="Kicker" value={s('kicker')} onChange={(v) => edit((d) => (d['kicker'] = v))} />
          <Text
            label="Version flag"
            value={s('flag')}
            placeholder="1.6"
            hint="Diagonal ribbon, top right. Leave empty for none."
            onChange={(v) => edit((d) => (d['flag'] = v))}
          />
        </>
      );

    case 'preview-screenshot': {
      const fit = (s('fit') ?? 'cover') as 'cover' | 'contain';
      const annotations = (value['annotations'] as Annotation[]) ?? [];

      return (
        <>
          <AssetPicker
            label="Screenshot"
            value={s('screenshot')}
            annotatableOnly={annotations.length > 0}
            onChange={(v) => edit((d) => (d['screenshot'] = v))}
          />
          <Text
            label="Overlay heading"
            value={s('overlay')}
            hint="Keep to a few words — previews display small."
            onChange={(v) => edit((d) => (d['overlay'] = v))}
          />
          <Select
            label="Fit"
            value={fit}
            options={['cover', 'contain'] as const}
            hint="Use contain for a pre-cropped region, so nothing gets cropped twice."
            onChange={(v) => edit((d) => (d['fit'] = v))}
          />
          {fit === 'cover' && (
            <Select
              label="Crop anchor"
              value={(s('crop') ?? 'center') as 'center' | 'top' | 'bottom'}
              options={['center', 'top', 'bottom'] as const}
              onChange={(v) => edit((d) => (d['crop'] = v))}
            />
          )}
          <Text
            label="Version flag"
            value={s('flag')}
            placeholder="1.6"
            onChange={(v) => edit((d) => (d['flag'] = v))}
          />

          {fit !== 'contain' && annotations.length === 0 ? (
            <p className="hint">
              Switch <strong>Fit</strong> to <code>contain</code> to add annotations. Under
              <code> cover</code> the image is cropped to fill the canvas, so coordinates would no
              longer land where you place them.
            </p>
          ) : (
            <AnnotationEditor
              src={s('screenshot')}
              annotations={annotations}
              onChange={(next) =>
                edit((d) => (d['annotations'] = next.length ? next : undefined))
              }
            />
          )}
        </>
      );
    }

    case 'preview-fullbleed':
      return (
        <>
          <AssetPicker
            label="Screenshot"
            value={s('screenshot')}
            onChange={(v) => edit((d) => (d['screenshot'] = v))}
          />
          <Text
            label="Corner mark"
            value={s('mark')}
            hint="Small bottom-left mark. The only identity element besides the frame."
            onChange={(v) => edit((d) => (d['mark'] = v))}
          />
          <Select
            label="Crop anchor"
            value={(s('crop') ?? 'center') as 'center' | 'top' | 'bottom'}
            options={['center', 'top', 'bottom'] as const}
            onChange={(v) => edit((d) => (d['crop'] = v))}
          />
          <Text
            label="Version flag"
            value={s('flag')}
            placeholder="1.6"
            onChange={(v) => edit((d) => (d['flag'] = v))}
          />
        </>
      );

    case 'carousel': {
      const annotations = (value['annotations'] as Annotation[]) ?? [];
      const n = (key: string) => value[key] as number | undefined;

      return (
        <>
          <AssetPicker
            label="Screenshot"
            value={s('screenshot')}
            // Contained on a canvas, so the intrinsic size is required.
            annotatableOnly
            onChange={(v) => edit((d) => (d['screenshot'] = v))}
          />
          <Text
            label="Caption"
            value={s('caption')}
            onChange={(v) => edit((d) => (d['caption'] = v))}
          />

          <div className="row">
            <Num
              label="Canvas width"
              value={n('width')}
              min={320}
              max={2560}
              onChange={(v) => edit((d) => (d['width'] = v))}
            />
            <Num
              label="Canvas height"
              value={n('height')}
              min={320}
              max={1440}
              onChange={(v) => edit((d) => (d['height'] = v))}
            />
          </div>
          <p className="hint" style={{ marginTop: -8 }}>
            Keep these identical across the carousel so the set is one size. Stay close to your
            screenshots' own dimensions — a much larger canvas cannot be filled without upscaling,
            leaving a small picture in an empty frame.
          </p>

          <Check
            label="Upscale to fill the canvas"
            value={value['upscale'] as boolean | undefined}
            hint="Off keeps the screenshot at its own size, sharp but possibly small in the frame. On fills the canvas at the cost of softer text — worth it for a capture much smaller than the canvas."
            onChange={(v) => edit((d) => (d['upscale'] = v))}
          />

          <Num
            label="Dim"
            value={n('dim')}
            min={0}
            max={1}
            step={0.05}
            hint="How much to darken outside the highlights. 0.66 suits a small target in a busy frame; ~0.35 when the surroundings are worth reading too."
            onChange={(v) => edit((d) => (d['dim'] = v))}
          />

          <AnnotationEditor
            src={s('screenshot')}
            annotations={annotations}
            onChange={(next) => edit((d) => (d['annotations'] = next.length ? next : undefined))}
          />
        </>
      );
    }

    // Anything the schema knows about but this file has no form for.
    default:
      return info ? (
        <GenericForm info={info} value={value} onChange={(next) => onChange(next as Content)} />
      ) : (
        <p className="hint">Unknown content type &ldquo;{String(value.type)}&rdquo;.</p>
      );
  }
}

/* ---------------------------------------------------------------------------
 * Body items
 * ------------------------------------------------------------------------ */

function BodyEditor({
  items,
  onChange,
}: {
  items: BodyItem[];
  onChange: (items: BodyItem[]) => void;
}) {
  const replace = (i: number, item: BodyItem) => {
    const next = [...items];
    next[i] = item;
    onChange(next);
  };

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <>
      <h2 className="section-title">Body</h2>

      {items.map((item, i) => (
        <div className="card" key={i}>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="preview-caption">
              {'p' in item ? 'paragraph' : 'list' in item ? 'list' : 'image'}
            </span>
            <div className="spacer" />
            <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up">
              ↑
            </button>
            <button onClick={() => move(i, 1)} disabled={i === items.length - 1} title="Move down">
              ↓
            </button>
            <button
              className="danger"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              title="Remove"
            >
              ✕
            </button>
          </div>

          {'p' in item && (
            <Area
              label="Paragraph"
              value={item.p}
              rows={3}
              hint="**bold** and _highlight_ are supported."
              onChange={(v) => replace(i, { p: v })}
            />
          )}

          {'list' in item && (
            <Area
              label="List items (one per line)"
              value={item.list.join('\n')}
              rows={4}
              onChange={(v) =>
                replace(i, { list: v.split('\n').map((l) => l.trim()).filter(Boolean) })
              }
            />
          )}

          {'image' in item && (
            <>
              <AssetPicker
                label="Image"
                value={item.image.src}
                annotatableOnly={(item.image.annotations?.length ?? 0) > 0}
                onChange={(v) => replace(i, { image: { ...item.image, src: v } })}
              />
              <Text
                label="Caption"
                value={item.image.caption}
                onChange={(v) => replace(i, { image: { ...item.image, caption: v } })}
              />
              {(item.image.annotations?.length ?? 0) > 0 && (
                <Num
                  label="Dim"
                  value={item.image.dim}
                  min={0}
                  max={1}
                  step={0.05}
                  hint="Darkening outside the highlights. Lower it when the surrounding content is worth reading."
                  onChange={(v) => replace(i, { image: { ...item.image, dim: v } })}
                />
              )}
              <AnnotationEditor
                src={item.image.src}
                annotations={item.image.annotations ?? []}
                onChange={(next) =>
                  replace(i, {
                    image: { ...item.image, annotations: next.length ? next : undefined },
                  })
                }
              />
            </>
          )}
        </div>
      ))}

      <div className="row">
        <button onClick={() => onChange([...items, { p: '' }])}>+ Paragraph</button>
        <button onClick={() => onChange([...items, { list: [''] }])}>+ List</button>
        <button onClick={() => onChange([...items, { image: { src: '' } }])}>+ Image</button>
      </div>
    </>
  );
}
