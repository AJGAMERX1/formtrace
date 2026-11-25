import assert from 'node:assert/strict';
import test from 'node:test';
import { createFlock } from '../src/flock-tracker.js';
import { makePassScale } from '../src/pass-colors.js';

function inputs() {
  const flock = createFlock(16 / 9);
  let time = 0;
  function frame(points) {
    time += 1 / 12;
    flock.update({
      regions: points.map(([x, y]) => ({ x, y, size: 0.025, light: 55, mass: 100 })),
      cut: false,
    }, time);
  }
  function countAt(x, y) {
    const { columns, rows, counts } = flock.snapshot().heatmap;
    return counts[Math.floor(y * rows) * columns + Math.floor(x * columns)];
  }
  return { frame, countAt, flock };
}

test('dwelling in a cell adds one visit, departure and return add a second', () => {
  const { frame, countAt, flock } = inputs();
  const y = 0.47;
  for (let i = 0; i <= 20; i++) frame([[0.14 + 0.014 * i, y]]);
  for (let i = 0; i < 90; i++) frame([[0.42 + 0.0002 * Math.sin(i), y]]);
  assert.equal(countAt(0.42, y), 1);
  for (let i = 1; i <= 16; i++) frame([[0.42 + 0.014 * i, y]]);
  for (let i = 1; i <= 20; i++) frame([[0.644 - 0.014 * i, y]]);
  assert.equal(countAt(0.42, y), 2);
  assert.equal(flock.snapshot().trackCount, 1);
});

test('two birds crossing a cell contribute two independent visits', () => {
  const { frame, countAt, flock } = inputs();
  for (let i = 0; i < 48; i++) {
    const x = 0.12 + 0.015 * i;
    frame([[x, 0.47], [0.87 - 0.015 * i, 0.48]]);
  }
  assert.equal(countAt(0.5, 0.47), 2);
  const paths = flock.paths();
  assert.equal(paths.length, 2);
  assert.equal(new Set(paths.map(p => p.id)).size, 2);
  const directions = paths.map(p => Math.sign(p.points.at(-1)[0] - p.points[0][0]));
  assert.deepEqual(directions.sort(), [-1, 1]);
});

test('stationary detections do not create paths or passes', () => {
  const { frame, flock } = inputs();
  for (let i = 0; i < 100; i++) frame([[0.42, 0.47]]);
  assert.equal(flock.snapshot().trackCount, 0);
  assert.equal(flock.snapshot().heatmap.maxPasses, 0);
});

test('busy flight corridors keep distinct colors above four passes', () => {
  const scale = makePassScale(23);
  const colors = Array.from({ length: 23 }, (_, i) => scale.color(i + 1));
  assert.equal(new Set(colors).size, 23);
  assert.equal(scale.color(0), 'transparent');
  assert.equal(scale.stops.at(-1).count, 23);
  assert.equal(scale.color(23), scale.stops.at(-1).color);
});
