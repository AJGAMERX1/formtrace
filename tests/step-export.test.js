import test from 'node:test';
import assert from 'node:assert/strict';
import { exportStep } from '../src/step-export.js';

function records(text) {
  return new Map(Array.from(text.matchAll(/^#(\d+)=(.*?);$/gms), match => [Number(match[1]), match[2]]));
}

function references(record) {
  return Array.from(record.matchAll(/#(\d+)/g), match => Number(match[1]));
}

function ofType(entities, type) {
  return [...entities.values()].filter(entity => entity.startsWith(type + '('));
}

// Follow the STEP topology back to the oriented polygon coordinates. Checking
// the volume detects a flipped shell as well as inconsistent triangle winding.
function shellVolume(shell, entities) {
  let volume = 0;
  const edges = new Map();
  for (const face of references(shell)) {
    const bound = references(entities.get(face))[0];
    const loop = references(entities.get(bound))[0];
    const ids = references(entities.get(loop));
    assert.equal(ids.length, 3);
    const [a,b,c] = ids.map(id => {
      const match = /^CARTESIAN_POINT\('',\(([^)]+)\)\)$/.exec(entities.get(id));
      assert.ok(match, 'A polygon corner must reference a Cartesian point');
      return match[1].split(',').map(Number);
    });
    volume += (a[0] * (b[1]*c[2] - b[2]*c[1]) + a[1] * (b[2]*c[0] - b[0]*c[2])
      + a[2] * (b[0]*c[1] - b[1]*c[0])) / 6;
    for (let j=0; j<3; j++) {
      const u = ids[j], v = ids[(j+1)%3];
      const key = Math.min(u,v) + ':' + Math.max(u,v);
      edges.set(key, (edges.get(key) ?? 0) + (u < v ? 1 : -1));
    }
  }
  assert([...edges.values()].every(balance => balance === 0), 'Every shared edge must have opposite uses');
  return volume;
}

test('seam duplicates and mismatched winding produce two outward, independently closed solids', async () => {
  const soup = [];
  for (const offset of [0, 4]) {
    const tetra = [[offset,0,0], [offset+1,0,0], [offset,1,0], [offset,0,1]];
    // The bottom face is reversed and one duplicated seam point has roundoff.
    for (const [face, corners] of [[0,1,2], [0,1,3], [1,2,3], [2,0,3]].entries()) {
      for (const corner of corners) {
        const [x,y,z] = tetra[corner];
        soup.push(x + (face === 2 && corner === 1 ? 1e-10 : 0), y, z);
      }
    }
  }
  const bytes = exportStep([{ name: 'Flight 2', positions: new Float64Array(soup), indices: null }]);
  assert.equal(bytes.type, 'model/step');
  const data = records(await bytes.text());
  assert.equal(ofType(data, 'FACETED_BREP').length, 2);
  const shells = ofType(data, 'CLOSED_SHELL');
  assert.equal(shells.length, 2);
  for (const shell of shells) assert(Math.abs(shellVolume(shell, data) - 1/6) < 1e-8);
  assert.equal(ofType(data, 'PRODUCT').length, 1);
  assert.equal(ofType(data, 'CARTESIAN_POINT').length, 9); // Eight geometry vertices plus placement origin.
});

test('preserves track product names and coordinates with millimetre units', async () => {
  const positions = new Float32Array([3,5,7, 4,5,7, 3,6,7]);
  const indices = new Uint16Array([0,1,2]);
  const text = await exportStep([
    { name: "Track A's", positions, indices },
    { name: 'Track B', positions, indices },
  ]).text();
  assert.match(text, /ISO-10303-21;\nHEADER;/);
  assert.match(text, /FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN'\)\)/);
  assert.match(text, /LENGTH_UNIT\(\) NAMED_UNIT\(\*\) SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
  assert.match(text, /PRODUCT\('Track A''s','Track A''s'/);
  assert.match(text, /PRODUCT\('Track B','Track B'/);
  assert.match(text, /CARTESIAN_POINT\('',\(3\.,5\.,7\.\)\)/);
});

test('open and non-manifold surfaces retain their planar faces without claiming enclosed volume', async () => {
  const positions = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1]);
  const flat = await exportStep([{ positions, indices: [0,1,2, 0,2,3] }]).text();
  const model = records(flat);
  assert.equal(ofType(model, 'ADVANCED_FACE').length, 2);
  assert.equal(ofType(model, 'OPEN_SHELL').length, 1);
  assert.equal(ofType(model, 'EDGE_CURVE').length, 5);
  assert.equal(ofType(model, 'FACETED_BREP').length, 0);
  const irregular = records(await exportStep([{ positions, indices: [0,1,2, 1,0,3, 0,1,4] }]).text());
  assert.equal(ofType(irregular, 'OPEN_SHELL').length, 3);
  assert.equal(ofType(irregular, 'FACETED_BREP').length, 0);
});

test('a pinched vertex does not turn touching sheets into a manifold solid', async () => {
  // Two caps meet at their apices and are joined by an outer square tube.
  const positions = [0,0,0, 1,1,1, -1,1,1, -1,-1,1, 1,-1,1, 1,1,-1, -1,1,-1, -1,-1,-1, 1,-1,-1];
  const indices = [];
  for (let i = 0; i < 4; i++) {
    const a = i+1, b = (i+1)%4+1;
    indices.push(0,a,b, 0,b+4,a+4, a,a+4,b+4, a,b+4,b);
  }
  const model = records(await exportStep([{ positions, indices }]).text());
  assert.equal(ofType(model, 'FACETED_BREP').length, 0);
  assert.equal(ofType(model, 'ADVANCED_FACE').length, 16);
});

test('rejects invalid indices, non-finite coordinates and entirely collapsed models', () => {
  const positions = [0,0,0, 1,0,0, 0,1,0];
  assert.throws(() => exportStep([{ positions, indices: [0,1,3] }]), /invalid triangle index/);
  assert.throws(() => exportStep([{ positions: [NaN,0,0, 1,0,0, 0,1,0] }]), /non-finite vertex/);
  assert.throws(() => exportStep([{ positions, indices: [0,1] }]), /complete triangles/);
  assert.throws(() => exportStep([{ positions: [0,0,0, 1,0,0, 2,0,0] }]), /no non-degenerate triangles/);
});
