import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';

// Stream the faceted CAD export so validation stays bounded on dense flocks.
async function validateStep(path, nodeNames, sourceTriangles) {
  const file = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: file, crlfDelay: Infinity });
  const productNames = new Set();
  const real = String.raw`([+-]?(?:\d+\.\d*|\.\d+)(?:E[+-]?\d+)?)`;
  const xyz = new RegExp(String.raw`^#\d+=(?:CARTESIAN_POINT|DIRECTION)\('',\(${real},${real},${real}\)\);$`);
  let header = '', inData = false, mm = false, faces = 0, points = 0;
  let previous = '', last = '';
  try {
    for await (const line of lines) {
      if (!line) continue;
      previous = last;
      last = line;
      if (!inData) {
        header += line + '\n';
        assert(header.length < 32768, 'Missing STEP header terminator');
        inData = line === 'DATA;';
        continue;
      }
      if (/NaN|Infinity|undefined/i.test(line)) assert.fail('STEP contains an invalid value: ' + line.slice(0, 100));
      if (line.includes('=FACE_SURFACE(') || line.includes('=ADVANCED_FACE(')) faces++;
      else if (line.includes('=CARTESIAN_POINT(') || line.includes('=DIRECTION(')) {
        const coord = xyz.exec(line);
        if (!coord || ![coord[1], coord[2], coord[3]].every(n => Number.isFinite(Number(n)))) {
          assert.fail('Invalid STEP XYZ triple: ' + line.slice(0, 100));
        }
        if (line.includes('=CARTESIAN_POINT(')) points++;
      } else if (line.includes('=PRODUCT(')) {
        const name = line.match(/=PRODUCT\('([^']+)'/)?.[1];
        assert(name && !productNames.has(name), 'STEP product names must be present and unique');
        productNames.add(name);
      } else if (line.includes('LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.)')) mm = true;
    }
  } finally {
    lines.close();
    file.destroy();
  }

  assert(header.startsWith('ISO-10303-21;\nHEADER;\n'), 'Missing STEP Part 21 prologue');
  assert(header.endsWith("FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n"), 'Expected the AP214 schema and data section');
  assert.equal(previous, 'ENDSEC;');
  assert.equal(last, 'END-ISO-10303-21;');
  assert(mm, 'STEP must declare a millimetre length unit');
  const tracks = new Set([...productNames].map(name => name.replace(/ surfaces$/, '')));
  assert.deepEqual([...tracks].sort(), [...nodeNames].sort(), 'STEP track products must match the GLB mesh nodes');
  assert(points >= nodeNames.length * 3, 'STEP needs vertices for every track');
  // Welding seams may discard degenerate triangles. Every flight path should
  // retain enough facets to explain the source mesh at its exported resolution.
  assert(faces >= sourceTriangles * 0.95 && faces <= sourceTriangles,
    'STEP has ' + faces + ' faces for ' + sourceTriangles + ' source triangles');
  return faces;
}

// A local clip can replace the built-in flock. The first argument can also
// point at the deployed site to exercise exactly what a visitor receives.
const [siteUrl, clip, region = 'full'] = process.argv.slice(2);
let server, browser;

try {
  if (!siteUrl) {
    server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
    await server.listen();
  }
  const url = siteUrl ?? server.resolvedUrls.local[0];
  const engine = process.env.FORMTRACE_BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch();
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(60000);

  await page.goto(url);
  await page.locator('#capture-motion').click();
  if (clip) {
    await page.locator('#capture-file').setInputFiles(clip);
  } else {
    await page.locator('#capture-sample').click();
  }
  await page.locator('#capture-area-preset').selectOption(region);

  const start = Date.now();
  await page.locator('#capture-start').click();
  await page.locator('#capture-apply').waitFor({ timeout: clip ? 180000 : 60000 });
  const analysisSeconds = Math.round((Date.now() - start) / 100) / 10;
  await page.getByRole('button', { name: 'Pass heat map', exact: true }).click();
  const summary = await page.locator('#capture-count').innerText();
  const tracks = Number(summary.match(/(\d+) motion tracks?/)?.[1]);
  const peak = Number(summary.match(/Peak (\d+) pass/)?.[1]);
  assert(tracks >= 2, 'Expected at least two independent tracks, got ' + summary);
  assert(peak >= 2, 'Expected a revisited cell, got ' + summary);
  await page.locator('#capture-apply').click();

  const trace = await page.locator('#trace').getAttribute('d');
  const visibleTracks = (trace.match(/M/g) ?? []).length;
  assert.equal(visibleTracks, Math.min(48, tracks), 'Separate input paths must survive sculpting');
  await page.locator('#view-heatmap').click();
  assert.equal(await page.locator('#capture-count').innerText(), summary);
  const map = page.locator('#capture-saved-map');
  await map.waitFor();
  const hotspot = await map.evaluate(canvas => {
    const peakSwatch = document.querySelector('.capture-legend i[data-peak="true"]');
    const color = getComputedStyle(peakSwatch).getPropertyValue('--pass-color').trim();
    const target = parseInt(color.slice(1), 16);
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    function rgb(x, y) {
      const i = 4 * (canvas.width * y + x);
      return data[i] * 65536 + data[i + 1] * 256 + data[i + 2];
    }
    let candidate = null, distance = Infinity;
    for (let y = 4; y < canvas.height - 4; y += 2) {
      for (let x = 4; x < canvas.width - 4; x += 2) {
        if ([rgb(x, y), rgb(x - 3, y - 3), rgb(x + 3, y + 3)].some(color => color !== target)) continue;
        const next = Math.hypot(x / canvas.width - 0.5, y / canvas.height - 0.5);
        if (next < distance) {
          distance = next;
          candidate = { x: (x + 0.5) / canvas.width, y: (y + 0.5) / canvas.height };
        }
      }
    }
    return candidate;
  });
  assert(hotspot, 'Saved map is missing the most-visited color');
  const stage = page.locator('.capture-stage');
  const bounds = await stage.boundingBox();
  await stage.click({ position: { x: hotspot.x * bounds.width, y: hotspot.y * bounds.height } });
  const cell = await page.locator('#capture-cell-value').innerText();
  assert.equal(Number(cell.match(/(\d+) pass/)?.[1]), peak, 'Cell value disagrees with legend');
  if (region === 'upper' || region === 'lower') {
    const y = bounds.height * (region === 'upper' ? 0.80 : 0.20);
    for (const fraction of [0.25, 0.5, 0.75]) {
      await stage.click({ position: { x: bounds.width * fraction, y } });
      assert.match(await page.locator('#capture-cell-value').innerText(), /· 0 passes$/);
    }
  }
  await page.locator('#capture-close').click();

  await page.locator('#undo').click();
  assert(await page.locator('#view-heatmap').isHidden());
  await page.locator('#redo').click();
  assert.equal(await page.locator('#trace').getAttribute('d'), trace);
  assert(await page.locator('#view-heatmap').isVisible());

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
  const bytes = await readFile(await download.path());
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const nodes = gltf.nodes.filter(node => Number.isInteger(node.mesh));
  assert.equal(nodes.length, visibleTracks, 'One GLB mesh node per exported flight path');
  assert.equal(new Set(nodes.map(node => node.name)).size, nodes.length);
  let sourceTriangles = 0;
  for (const node of nodes) {
    const primitive = gltf.meshes[node.mesh].primitives[0];
    const positions = gltf.accessors[primitive.attributes.POSITION];
    sourceTriangles += (primitive.indices === undefined ? positions.count : gltf.accessors[primitive.indices].count) / 3;
    assert(positions.count > 2 && positions.min.every(Number.isFinite) && positions.max.every(Number.isFinite));
  }
  await page.getByRole('button', { name: 'Choose export format' }).click();
  const [stepDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    page.getByRole('menuitem', { name: 'Download STEP', exact: true }).click(),
  ]);
  assert.match(stepDownload.suggestedFilename(), /\.step$/i);
  const stepFaces = await validateStep(await stepDownload.path(), nodes.map(node => node.name), sourceTriangles);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ url, browser: engine.name(), input: clip ?? 'Built-in flock footage', region, analysisSeconds, tracks, peak, inspected: cell, exportedPaths: nodes.length, stepFaces }));
} finally {
  await browser?.close();
  await server?.close();
}
