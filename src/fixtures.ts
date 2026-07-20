import { join } from 'node:path';
import { Renderer } from './render.js';

/**
 * Stand-in screenshots. placeholder.png is noisy enough to exercise the size
 * limit and quantization path; worktab.png is a predictable grid for
 * annotation coordinates.
 */

const NOISE_HTML = `<!doctype html><html><head><style>
  html,body{margin:0;padding:0;background:#2b2417}
  #capture{width:640px;height:360px;position:relative;overflow:hidden}
  canvas{width:640px;height:360px;display:block}
</style></head><body>
<div id="capture"><canvas id="c" width="1280" height="720"></canvas></div>
<script>
  const c = document.getElementById('c');
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0,0,0,720);
  g.addColorStop(0,'#4a5c33'); g.addColorStop(0.5,'#6b6340'); g.addColorStop(1,'#3c3524');
  x.fillStyle = g; x.fillRect(0,0,1280,720);
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 5200; i++) {
    x.fillStyle = 'hsl(' + Math.floor(rnd()*360) + ',' + (25+rnd()*45) + '%,' + (18+rnd()*55) + '%)';
    x.fillRect(rnd()*1280, rnd()*720, 4+rnd()*22, 4+rnd()*22);
  }
  x.strokeStyle = 'rgba(20,16,10,0.55)'; x.lineWidth = 2;
  for (let i = 0; i < 240; i++) {
    x.strokeRect(rnd()*1200, rnd()*660, 20+rnd()*90, 20+rnd()*90);
  }
  const img = x.getImageData(0,0,1280,720);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd()-0.5) * 46;
    img.data[i] += n; img.data[i+1] += n; img.data[i+2] += n;
  }
  x.putImageData(img,0,0);
</script></body></html>`;

/*
 * Grid geometry in source pixels (rendered 1:1):
 *   name column   x 0..140
 *   job column i  x = 140 + 34*i, width 34   (i = 0..9)
 *   header row    y 0..34
 *   pawn row r    y = 34 + 30*r, height 30   (r = 0..6)
 */
const WORKTAB_HTML = `<!doctype html><html><head><style>
  html,body{margin:0;padding:0}
  #capture{width:520px;height:244px;position:relative;overflow:hidden}
  canvas{width:520px;height:244px;display:block}
</style></head><body>
<div id="capture"><canvas id="c" width="520" height="244"></canvas></div>
<script>
  const x = document.getElementById('c').getContext('2d');
  x.fillStyle = '#3a3a3a'; x.fillRect(0,0,520,244);
  x.fillStyle = '#2e2e2e'; x.fillRect(0,0,520,34);
  x.lineWidth = 1;
  x.textBaseline = 'middle';
  const jobs = ['Fire','Doct','Bed','Base','Warn','Cons','Grow','Mine','Cook','Hunt'];
  for (let i = 0; i < 10; i++) {
    const cx = 140 + 34*i;
    x.save();
    x.translate(cx + 22, 28); x.rotate(-Math.PI/3);
    x.fillStyle = '#cfcfcf'; x.font = '10px sans-serif';
    x.fillText(jobs[i], 0, 0);
    x.restore();
  }
  const pawns = ['Ellis','Marn','Toko','Vera','Juno','Pike','Sable'];
  for (let r = 0; r < 7; r++) {
    const ry = 34 + 30*r;
    x.fillStyle = r % 2 ? '#343434' : '#3c3c3c';
    x.fillRect(0, ry, 520, 30);
    x.fillStyle = '#e2e2e2'; x.font = '12px sans-serif';
    x.fillText(pawns[r], 10, ry + 15);
    for (let i = 0; i < 10; i++) {
      const cx = 140 + 34*i;
      x.strokeStyle = '#585858';
      x.strokeRect(cx + 0.5, ry + 0.5, 34, 30);
      const v = (r*3 + i*7) % 5;
      if (v) {
        x.fillStyle = ['#8a8a8a','#b7a24a','#5f9e57','#4a86b7','#b76a4a'][v];
        x.font = '13px sans-serif';
        x.fillText(String(v), cx + 14, ry + 16);
      }
    }
  }
  // The cell the sample annotation points at: row 2, column 3.
  x.fillStyle = '#2a2a2a'; x.fillRect(243, 95, 32, 28);
  x.strokeStyle = '#d0a040'; x.strokeRect(243.5, 95.5, 31, 27);
  x.fillStyle = '#d0a040'; x.font = '15px sans-serif';
  x.fillText('\\u2716', 251, 110);
</script></body></html>`;

export async function makeFixtures(assetsDir: string): Promise<string[]> {
  const renderer = new Renderer();
  await renderer.open();
  const written: string[] = [];

  try {
    const fixtures = [
      // 2x, so this lands at 1280x720 like a real screenshot.
      {
        html: NOISE_HTML,
        out: join(assetsDir, 'screenshots/placeholder.png'),
        size: { width: 640, height: 360 },
        scale: 2,
      },
      // 1x, so the PNG's pixel space matches the geometry documented above and
      // annotation coordinates can be written straight from it.
      {
        html: WORKTAB_HTML,
        out: join(assetsDir, 'screenshots/worktab.png'),
        size: { width: 520, height: 244 },
        scale: 1,
      },
    ];

    for (const f of fixtures) {
      const r = await renderer.render({
        html: f.html,
        outPath: f.out,
        fixed: f.size,
        scale: f.scale,
      });
      console.log(`  ${r.outPath} (${r.bytes} bytes)`);
      written.push(r.outPath);
    }
  } finally {
    await renderer.close();
  }

  return written;
}
