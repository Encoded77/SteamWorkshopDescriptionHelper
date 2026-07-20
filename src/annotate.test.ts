import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotatedImage, type Annotation } from './annotate.js';

const NATURAL = { width: 1000, height: 1000 };

function render(a: Partial<Annotation> = {}): string {
  return annotatedImage({
    dataUri: 'data:image/png;base64,',
    natural: NATURAL,
    label: 'test.yaml',
    annotations: [{ x: 400, y: 400, width: 100, height: 100, text: 'Label', side: 'right', ...a }],
  }).value;
}

const segments = (html: string): number => html.split('class="anno__leader"').length - 1;
const styleOf = (html: string, cls: string): string =>
  html.match(new RegExp(`class="${cls}"[^>]*style="([^"]*)"`))![1]!;

test('an unplaced label keeps the single straight leader', () => {
  assert.equal(segments(render()), 1);
  assert.match(styleOf(render(), 'anno__label'), /right: 8px/);
});

test('a placed label gets a three-segment elbow', () => {
  assert.equal(segments(render({ at: { x: 900, y: 800 } })), 3);
});

test('a placed label already in line with the region uses one segment', () => {
  // 400 + 100/2 on the free axis, so the elbow would have nowhere to turn.
  assert.equal(segments(render({ at: { x: 900, y: 450 } })), 1);
});

test('the label is anchored where the leader lands, on the face it arrives at', () => {
  // Leader travels rightward, so it meets the label's left face.
  assert.match(styleOf(render({ side: 'right', at: { x: 900, y: 300 } }), 'anno__label'), /left: 90\.0000%; top: 30\.0000%/);
  // Travelling leftward, it meets the right face, so the label grows leftward.
  assert.match(styleOf(render({ side: 'left', at: { x: 100, y: 300 } }), 'anno__label'), /right: calc\(100% - 10\.0000%\)/);
  assert.match(styleOf(render({ side: 'top', at: { x: 300, y: 100 } }), 'anno__label'), /bottom: calc\(100% - 10\.0000%\)/);
  assert.match(styleOf(render({ side: 'bottom', at: { x: 300, y: 900 } }), 'anno__label'), /left: 30\.0000%; top: 90\.0000%/);
});

test('both axes are free: same region and side, two different label positions', () => {
  const a = styleOf(render({ side: 'right', at: { x: 600, y: 100 } }), 'anno__label');
  const b = styleOf(render({ side: 'right', at: { x: 950, y: 900 } }), 'anno__label');
  assert.match(a, /left: 60\.0000%; top: 10\.0000%/);
  assert.match(b, /left: 95\.0000%; top: 90\.0000%/);
});

test('the turn never overshoots the label', () => {
  // The stub is 3% of 1000 = 30px, but the label is only 10px past the region.
  const html = render({ side: 'right', at: { x: 510, y: 800 } });
  for (const m of html.matchAll(/left: ([\d.]+)%/g)) {
    assert.ok(Number(m[1]) <= 51, `a segment turns at ${m[1]}%, past the label at 51%`);
  }
});

test('every segment stays inside the image when the region hugs an edge', () => {
  // The region's far face is the image border, so the anchor can only sit on
  // the border itself and the stub has no room at all to run before turning.
  for (const a of [
    { x: 960, width: 40, side: 'right' as const, at: { x: 1000, y: 100 } },
    { x: 0, width: 40, side: 'left' as const, at: { x: 0, y: 100 } },
    { y: 960, height: 40, side: 'bottom' as const, at: { x: 100, y: 1000 } },
    { y: 0, height: 40, side: 'top' as const, at: { x: 100, y: 0 } },
  ]) {
    for (const m of render(a).matchAll(/(?:left|top): (-?[\d.]+)%/g)) {
      const v = Number(m[1]);
      assert.ok(v >= 0 && v <= 100, `${a.side}: a segment at ${v}% escapes the image`);
    }
  }
});

test('a label the leader cannot reach from its side is rejected', () => {
  assert.throws(
    () => render({ side: 'right', at: { x: 100, y: 800 } }),
    /label at 100,800 is not to the right of the region/,
  );
  assert.throws(() => render({ side: 'top', at: { x: 100, y: 800 } }), /not to the top/);
});

test('a label outside the image is rejected', () => {
  assert.throws(() => render({ at: { x: 1200, y: 100 } }), /label at 1200,100 falls outside/);
});
