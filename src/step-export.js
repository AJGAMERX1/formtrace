// ISO 10303-214 faceted geometry. Source coordinates and the STEP length unit
// are both millimetres. The displayed track surfaces remain separate parts.
const WELD = 1e-8;
const NEXT = [1, 2, 0];

function real(value) {
  const [mantissa, exponent] = Number(value.toPrecision(12)).toString().split('e');
  const decimal = mantissa.includes('.') ? mantissa : mantissa + '.';
  return exponent === undefined ? decimal : decimal + 'E' + exponent;
}

function quoted(value) {
  // Escape Part 21 delimiters. Encode non-ASCII UTF-16 code units using X2.
  const text = String(value).replace(/[\x00-\x1f\x7f]/g, ' ');
  return "'" + text.replace(/['\\]|[^\x20-\x7e]+/g, part => {
    if (part === "'") return "''";
    if (part === '\\') return '\\\\';
    let hex = '';
    for (let i = 0; i < part.length; i++) hex += part.charCodeAt(i).toString(16).padStart(4, '0');
    return '\\X2\\' + hex.toUpperCase() + '\\X0\\';
  }) + "'";
}

function refList(ids) {
  const groups = [];
  for (let i = 0; i < ids.length; i += 16) {
    groups.push(ids.slice(i, i + 16).map(id => '#' + id).join(','));
  }
  return '(' + groups.join(',\n') + ')';
}

function createWriter(name) {
  const blocks = [];
  let lines = [], length = 0, nextId = 1;
  function add(text) {
    lines.push(text);
    length += text.length;
    if (length >= 65536) {
      blocks.push(lines.join(''));
      lines = [];
      length = 0;
    }
  }
  add("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Formtrace triangulated surfaces; one studio unit is one millimetre'),'2;1');\n");
  add('FILE_NAME(' + quoted(name) + ',' + quoted(new Date().toISOString()) + ",('Formtrace'),('Formtrace'),'Formtrace','Formtrace','');\n");
  add("FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n");
  return {
    entity(record) {
      const id = nextId++;
      add('#' + id + '=' + record + ';\n');
      return id;
    },
    finish() {
      add('ENDSEC;\nEND-ISO-10303-21;\n');
      blocks.push(lines.join(''));
      return new Blob(blocks, { type: 'model/step' });
    },
  };
}

function modelContext(write) {
  const app = write("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  write("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#" + app + ')');
  const product = write("PRODUCT_CONTEXT('',#" + app + ",'mechanical')");
  const design = write("PRODUCT_DEFINITION_CONTEXT('part definition',#" + app + ",'design')");
  const mm = write('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))');
  const rad = write('(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))');
  const sr = write('(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())');
  const tolerance = write("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),#" + mm + ",'distance_accuracy_value','')");
  const space = write('(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#' + tolerance +
    ')) GLOBAL_UNIT_ASSIGNED_CONTEXT((#' + mm + ',#' + rad + ',#' + sr + ")) REPRESENTATION_CONTEXT('','3D'))");
  const origin = write("CARTESIAN_POINT('',(0.,0.,0.))");
  const z = write("DIRECTION('',(0.,0.,1.))"), x = write("DIRECTION('',(1.,0.,0.))");
  const axes = write("AXIS2_PLACEMENT_3D('',#" + origin + ',#' + z + ',#' + x + ')');
  return { product, design, space, axes };
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// Duplicate positions at UV seams and poles are the same geometric vertex.
// Check neighboring buckets as well so roundoff across a bucket edge cannot
// turn a watertight ellipsoid into an open surface.
function topology({ positions, indices }) {
  if (!positions || positions.length % 3) throw new Error('STEP needs packed XYZ positions.');
  const count = positions.length / 3;
  const size = indices ? indices.length : count;
  if (size % 3) throw new Error('STEP needs complete triangles.');
  const vertices = [], faces = [], bins = new Map();
  const canonical = new Int32Array(count).fill(-1);
  function vertex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('STEP found an invalid triangle index.');
    if (canonical[index] >= 0) return canonical[index];
    const at = index * 3;
    const p = [positions[at], positions[at + 1], positions[at + 2]];
    if (!p.every(Number.isFinite)) throw new Error('STEP found a non-finite vertex.');
    const [x, y, z] = p.map(n => Math.floor(n / WELD));
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const nearby = bins.get([x + dx, y + dy, z + dz].join(','));
          if (!nearby) continue;
          for (const id of nearby) {
            const q = vertices[id];
            if ((p[0]-q[0])**2 + (p[1]-q[1])**2 + (p[2]-q[2])**2 <= WELD * WELD) {
              canonical[index] = id;
              return id;
            }
          }
        }
      }
    }
    const id = vertices.length, key = [x, y, z].join(',');
    if (bins.has(key)) bins.get(key).push(id);
    else bins.set(key, [id]);
    vertices.push(p);
    canonical[index] = id;
    return id;
  }
  for (let i = 0; i < size; i += 3) {
    const a = vertex(indices ? indices[i] : i);
    const b = vertex(indices ? indices[i+1] : i+1);
    const c = vertex(indices ? indices[i+2] : i+2);
    if (a === b || b === c || c === a) continue;
    const ab = sub(vertices[b], vertices[a]), ac = sub(vertices[c], vertices[a]);
    const n = cross(ab, ac);
    if (dot(n, n) <= WELD**2 * Math.max(dot(ab, ab), dot(ac, ac))) continue;
    faces.push([a, b, c]);
  }
  return { vertices, faces };
}

function components({ vertices, faces }) {
  const adjacent = new Int32Array(faces.length * 3).fill(-1);
  const irregular = new Uint8Array(faces.length), edges = new Map();
  const n = vertices.length;
  for (let i = 0; i < faces.length; i++) {
    for (let side = 0; side < 3; side++) {
      const u = faces[i][side], v = faces[i][NEXT[side]];
      const key = Math.min(u,v) * n + Math.max(u,v), half = i * 3 + side;
      const previous = edges.get(key);
      if (previous === undefined) edges.set(key, half);
      else if (adjacent[previous] === -1) {
        adjacent[previous] = half;
        adjacent[half] = previous;
      } else {
        irregular[Math.floor(previous / 3)] = 1;
        irregular[Math.floor(adjacent[previous] / 3)] = 1;
        irregular[i] = 1;
      }
    }
  }
  const checkedCorners = new Uint8Array(faces.length * 3);
  const vertexPatch = new Int32Array(vertices.length).fill(-1);
  // Even with exactly two faces per edge, a surface can pinch at a vertex.
  // Each vertex must have one connected fan of incident faces in this patch.
  function hasSingleFans(members, patchId) {
    const stack = [];
    for (const face of members) {
      for (let side = 0; side < 3; side++) {
        const first = face * 3 + side;
        if (checkedCorners[first]) continue;
        const vertex = faces[face][side];
        if (vertexPatch[vertex] === patchId) return false;
        vertexPatch[vertex] = patchId;
        checkedCorners[first] = 1;
        stack.push(first);
        while (stack.length) {
          const corner = stack.pop();
          const triangle = Math.floor(corner / 3), local = corner % 3;
          for (const edge of [local, (local + 2) % 3]) {
            const neighbor = adjacent[triangle * 3 + edge];
            if (neighbor < 0) continue;
            const nextTriangle = Math.floor(neighbor / 3), nextEdge = neighbor % 3;
            const nextCorner = faces[nextTriangle][nextEdge] === vertex ? nextEdge : NEXT[nextEdge];
            const next = 3 * nextTriangle + nextCorner;
            if (!checkedCorners[next]) {
              checkedCorners[next] = 1;
              stack.push(next);
            }
          }
        }
      }
    }
    return true;
  }

  const sense = new Int8Array(faces.length), result = [];
  for (let seed = 0; seed < faces.length; seed++) {
    if (sense[seed]) continue;
    const members = [seed], origin = vertices[faces[seed][0]];
    sense[seed] = 1;
    let closed = true, manifold = true, volume6 = 0, area2 = 0;
    for (let cursor = 0; cursor < members.length; cursor++) {
      const i = members[cursor], face = faces[i];
      if (irregular[i]) manifold = false;
      const a = vertices[face[0]], b = vertices[face[1]], c = vertices[face[2]];
      const normal = cross(sub(b,a), sub(c,a));
      volume6 += sense[i] * dot(sub(a,origin), normal);
      area2 += Math.hypot(...normal);
      for (let side = 0; side < 3; side++) {
        const other = adjacent[i*3+side];
        if (other < 0) { closed = false; continue; }
        const j = Math.floor(other/3);
        const orientation = faces[j][other % 3] === face[side] ? -sense[i] : sense[i];
        if (!sense[j]) {
          sense[j] = orientation;
          members.push(j);
        } else if (sense[j] !== orientation) manifold = false;
      }
    }
    // A flattened, nominally closed shell has no enclosed volume.
    if (closed && Math.abs(volume6) <= area2 * WELD) manifold = false;
    if (manifold) manifold = hasSingleFans(members, seed);
    const solid = closed && manifold;
    for (const i of members) {
      if (sense[i] * (solid && volume6 < 0 ? -1 : 1) < 0) {
        [faces[i][1], faces[i][2]] = [faces[i][2], faces[i][1]];
      }
    }
    result.push({ members, solid, manifold });
  }
  return result;
}

function writePart(write, context, part, name) {
  const data = topology(part);
  const { vertices, faces } = data;
  if (!faces.length) return false;
  const patches = components(data);
  const pointIds = new Int32Array(vertices.length), vertexIds = new Int32Array(vertices.length);
  const curveIds = new Map(), solids = [], surfaces = [];
  function point(i) {
    if (!pointIds[i]) pointIds[i] = write("CARTESIAN_POINT('',(" + vertices[i].map(real).join(',') + '))');
    return pointIds[i];
  }
  function direction(vector) {
    const size = Math.hypot(...vector);
    return write("DIRECTION('',(" + vector.map(v => real(v / size)).join(',') + '))');
  }
  // Surface models require EDGE_LOOP and ADVANCED_FACE. Use shared geometric
  // edges and select their direction separately for each incident triangle.
  function orientedEdge(a, b) {
    const lo = Math.min(a,b), hi = Math.max(a,b);
    const key = lo * vertices.length + hi;
    let id = curveIds.get(key);
    if (!id) {
      for (const i of [lo,hi]) {
        if (!vertexIds[i]) vertexIds[i] = write("VERTEX_POINT('',#" + point(i) + ')');
      }
      const dir = direction(sub(vertices[hi], vertices[lo]));
      const vec = write("VECTOR('',#" + dir + ',1.)');
      const line = write("LINE('',#" + point(lo) + ',#' + vec + ')');
      id = write("EDGE_CURVE('',#" + vertexIds[lo] + ',#' + vertexIds[hi] + ',#' + line + ',.T.)');
      curveIds.set(key, id);
    }
    return write("ORIENTED_EDGE('',*,*,#" + id + ',' + (a === lo ? '.T.' : '.F.') + ')');
  }

  for (const { members, solid, manifold } of patches) {
    const faceIds = [];
    for (const i of members) {
      const [a,b,c] = faces[i];
      const ab = sub(vertices[b], vertices[a]), ac = sub(vertices[c], vertices[a]);
      const normal = direction(cross(ab, ac)), tangent = direction(ab);
      const placement = write("AXIS2_PLACEMENT_3D('',#" + point(a) + ',#' + normal + ',#' + tangent + ')');
      const plane = write("PLANE('',#" + placement + ')');
      const loop = solid
        ? write("POLY_LOOP(''," + refList([point(a), point(b), point(c)]) + ')')
        : write("EDGE_LOOP(''," + refList([orientedEdge(a,b), orientedEdge(b,c), orientedEdge(c,a)]) + ')');
      const bound = write("FACE_OUTER_BOUND('',#" + loop + ',.T.)');
      const face = write((solid ? 'FACE_SURFACE' : 'ADVANCED_FACE') + "('',(#" + bound + '),#' + plane + ',.T.)');
      faceIds.push(face);
    }
    if (solid) {
      const shell = write("CLOSED_SHELL(''," + refList(faceIds) + ')');
      solids.push(write('FACETED_BREP(' + quoted(name) + ',#' + shell + ')'));
    } else {
      // An irregular or non-orientable set cannot be asserted to be one shell.
      // Separate triangular sheets retain every non-degenerate source facet.
      const shells = manifold ? [write("OPEN_SHELL(''," + refList(faceIds) + ')')]
        : faceIds.map(face => write("OPEN_SHELL('',(#" + face + '))'));
      surfaces.push(write('SHELL_BASED_SURFACE_MODEL(' + quoted(name) + ',' + refList(shells) + ')'));
    }
  }

  function product(items, representation, label) {
    const tag = quoted(label);
    const p = write('PRODUCT(' + tag + ',' + tag + ",'',(#" + context.product + '))');
    const form = write("PRODUCT_DEFINITION_FORMATION('','',#" + p + ')');
    const definition = write("PRODUCT_DEFINITION('design','',#" + form + ',#' + context.design + ')');
    const shape = write("PRODUCT_DEFINITION_SHAPE('','',#" + definition + ')');
    const rep = write(representation + '(' + tag + ',' + refList([context.axes, ...items]) + ',#' + context.space + ')');
    write('SHAPE_DEFINITION_REPRESENTATION(#' + shape + ',#' + rep + ')');
    write("PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#" + p + '))');
  }
  if (solids.length) product(solids, 'FACETED_BREP_SHAPE_REPRESENTATION', name);
  if (surfaces.length) product(surfaces, 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION', solids.length ? name + ' surfaces' : name);
  return true;
}

/** Write packed triangle positions and optional indices to a browser-local AP214 STEP Blob. */
export function exportStep(meshes, name = 'Formtrace') {
  const writer = createWriter(name), context = modelContext(writer.entity);
  let parts = 0;
  for (const mesh of meshes) {
    if (writePart(writer.entity, context, mesh, mesh.name || name)) parts++;
  }
  if (!parts) throw new Error('This object has no non-degenerate triangles to export.');
  return writer.finish();
}
