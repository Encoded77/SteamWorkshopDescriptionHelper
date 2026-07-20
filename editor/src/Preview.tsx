import { useEffect, useRef, useState } from 'react';
import { api, type Content } from './api';
import { canvasWidth, useTypeInfo } from './schema';

/**
 * The iframe is filled with the same HTML the exporter rasterizes, fetched from
 * the server, so the preview cannot drift from the output.
 */
export function Preview({ data }: { data: Content | null }) {
  const [html, setHtml] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [height, setHeight] = useState(200);
  const [scale, setScale] = useState(1);
  const frame = useRef<HTMLIFrameElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const info = useTypeInfo(data?.type);

  // Serialized, so an edit producing an equal value skips the round-trip.
  const key = data ? JSON.stringify(data) : '';

  useEffect(() => {
    if (!data) {
      setHtml('');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await api.previewDraft(data);
        if (cancelled) return;
        if (result.ok && result.html) {
          setHtml(result.html);
          setErrors([]);
        } else {
          setErrors(result.errors ?? ['Could not render.']);
        }
      } catch (err) {
        if (!cancelled) setErrors([err instanceof Error ? err.message : String(err)]);
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const width = canvasWidth(info, (data ?? {}) as Record<string, unknown>);

  function fit() {
    const doc = frame.current?.contentDocument;
    const el = doc?.getElementById('capture');
    if (el) setHeight(Math.ceil(el.getBoundingClientRect().height));
  }

  // Rendered at true size and scaled to fit, rather than reflowed at a width
  // the exporter never uses.
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, el.clientWidth / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  return (
    <>
      <div className="preview-caption">
        {data
          ? `${data.type} · ${width}px${scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ''}`
          : 'Nothing selected'}
      </div>

      {errors.length > 0 && <div className="errors">{errors.join('\n')}</div>}

      <div ref={holder} className="preview-holder">
        {html && (
          <div style={{ width: width * scale, height: height * scale, overflow: 'hidden' }}>
            <iframe
              ref={frame}
              className="preview-frame"
              style={{
                width,
                height,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
              srcDoc={html}
              onLoad={fit}
              title="Preview"
              sandbox="allow-same-origin"
            />
          </div>
        )}
      </div>
    </>
  );
}
