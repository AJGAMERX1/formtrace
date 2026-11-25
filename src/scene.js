import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const cameraDirection = new THREE.Vector3(0.07, 0.18, 1).normalize();
const shortAxisSpan = 5.2;
const clamp = THREE.MathUtils.clamp;

function prepareCurve(points, preserveCoordinates) {
  const vertices = [];
  for (const point of points ?? []) {
    if (!point || point.length < 2) continue;
    const vertex = new THREE.Vector3(point[0], point[1], point[2] ?? 0);
    if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) continue;
    if (!vertices.length || vertices.at(-1).distanceToSquared(vertex) > 1e-9) vertices.push(vertex);
  }
  if (vertices.length < 2) return null;

  const bounds = new THREE.Box3().setFromPoints(vertices);
  const size = bounds.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  if (extent < 0.0001) return null;
  const closed = vertices.length > 4 && vertices[0].distanceTo(vertices.at(-1)) < extent * 0.005;
  if (closed) vertices.pop();
  if (!preserveCoordinates) {
    const midpoint = bounds.getCenter(new THREE.Vector3());
    for (const vertex of vertices) vertex.sub(midpoint).multiplyScalar(4 / extent);
  }
  const curve = new THREE.CatmullRomCurve3(vertices, closed, 'centripetal');
  curve.arcLengthDivisions = Math.min(2048, Math.max(240, vertices.length * 3));
  return curve;
}

function beadGeometry(curve, width, twist, thickness, trackCount) {
  const radius = (0.07 + width * 0.35) * thickness;
  const sides = trackCount > 1 ? 12 : 20;
  const rings = trackCount > 1 ? 8 : 12;
  const maxBeads = Math.min(190, Math.floor(120000 / (trackCount * (sides + 1) * (rings + 1))));
  const count = clamp(Math.round(curve.getLength() / (radius * 1.48)), 2, maxBeads);
  const frame = curve.computeFrenetFrames(count, curve.closed);
  const spheres = [];
  const matrix = new THREE.Matrix4();
  const orientation = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const across = new THREE.Vector3();
  const upright = new THREE.Vector3();
  const scale = new THREE.Vector3(radius * 1.11, radius * 0.81, radius * 1.07);
  const end = curve.closed ? count : count + 1;
  for (let i = 0; i < end; i++) {
    const angle = twist * 5 + i * twist * 0.9;
    across.copy(frame.normals[i]).applyAxisAngle(frame.tangents[i], angle);
    upright.crossVectors(frame.tangents[i], across);
    orientation.makeBasis(across, upright, frame.tangents[i]);
    quaternion.setFromRotationMatrix(orientation);
    matrix.compose(curve.getPointAt(i / count), quaternion, scale);
    spheres.push(new THREE.SphereGeometry(1, sides, rings).applyMatrix4(matrix));
  }
  const merged = mergeGeometries(spheres);
  for (const sphere of spheres) sphere.dispose();
  return merged;
}

function sweepGeometry(curve, width, twist, ribbon, live, thickness, trackCount) {
  const length = curve.getLength();
  const sides = trackCount > 1 ? 16 : (ribbon ? 24 : 20);
  const maxSteps = Math.floor(120000 / (trackCount * sides));
  const stepsPerFold = live ? 4 : 6;
  const folds = clamp(Math.round(length * 8), 4, Math.min(155, Math.floor(maxSteps / stepsPerFold)));
  const steps = ribbon ? folds * stepsPerFold : clamp(Math.round(length * 22), 24, Math.min(420, maxSteps));
  const rings = curve.closed ? steps : steps + 1;
  const positions = new Float32Array(rings * sides * 3);
  const colors = new Float32Array(positions.length);
  const indices = [];
  const frames = curve.computeFrenetFrames(steps, curve.closed);
  const samples = curve.getSpacedPoints(steps);
  const across = new THREE.Vector3();
  const face = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  const reference = new THREE.Vector3(0.25, 0.63, 0.9);
  const phase = Math.atan2(reference.dot(frames.binormals[0]), reference.dot(frames.normals[0]));
  const halfWidth = (ribbon ? 0.085 + width * 0.86 : 0.055 + width * 0.46) * thickness;
  for (let i = 0; i < rings; i++) {
    const t = i / steps;
    const rotation = curve.closed
      ? phase + TAU * t + twist * (1.3 + 1.65 * Math.sin(TAU * t))
      : phase + twist * (TAU * 1.75 * t + 0.4);
    across.copy(frames.normals[i]).applyAxisAngle(frames.tangents[i], rotation);
    face.crossVectors(frames.tangents[i], across);
    const crest = 0.5 + 0.5 * Math.cos(TAU * t * folds);
    for (let j = 0; j < sides; j++) {
      const angle = TAU * j / sides;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let u, v;
      if (ribbon) {
        const cross = Math.sign(cos) * Math.abs(cos) ** 0.72;
        const depth = Math.sign(sin) * Math.abs(sin) ** 0.72;
        u = halfWidth * cross * (0.942 + 0.058 * crest);
        v = halfWidth * (depth * (0.178 + 0.112 * crest) + 0.13 * (1 - cross * cross));
      } else {
        const groove = 0.97 + 0.03 * Math.cos(3 * angle + twist * TAU * t * 4);
        u = halfWidth * cos * groove;
        v = halfWidth * sin * groove * 0.89;
      }
      vertex.copy(samples[i]).addScaledVector(across, u).addScaledVector(face, v);
      const offset = 3 * (i * sides + j);
      vertex.toArray(positions, offset);
      const shade = ribbon ? 0.73 + 0.27 * crest : 1;
      colors[offset] = shade;
      colors[offset + 1] = shade ** 1.23;
      colors[offset + 2] = shade ** 0.7;
      if (i < steps) {
        const nextRing = ((i + 1) % rings) * sides;
        const nextSide = (j + 1) % sides;
        const a = i * sides + j;
        const b = i * sides + nextSide;
        indices.push(a, b, nextRing + nextSide, a, nextRing + nextSide, nextRing + j);
      }
    }
  }
  if (!curve.closed) {
    const end = (rings - 1) * sides;
    for (let j = 1; j < sides - 1; j++) {
      indices.push(0, j + 1, j, end, end + j, end + j + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeSculpture(points, settings = {}, live = false, paths) {
  const tracks = paths?.length > 1 ? paths : [{ points }];
  const thickness = tracks.length > 1 ? Math.max(0.07, 0.48 / Math.sqrt(tracks.length)) : 1;
  const width = clamp(Number(settings.width ?? 50) / 100, 0, 1);
  const twist = clamp(Number(settings.twist ?? 45) / 100, 0, 1);
  const beads = settings.shape === 'beads';
  const parts = [];
  const trackRanges = [];
  let vertexStart = 0, indexStart = 0;
  for (const track of tracks) {
    const curve = prepareCurve(track.points, live || tracks.length > 1);
    if (!curve) continue;
    const part = beads ? beadGeometry(curve, width, twist, thickness, tracks.length)
      : sweepGeometry(curve, width, twist, settings.shape !== 'tube', live, thickness, tracks.length);
    parts.push(part);
    const vertexCount = part.attributes.position.count, indexCount = part.index.count;
    trackRanges.push({ id: track.id, vertexStart, vertexCount, indexStart, indexCount });
    vertexStart += vertexCount;
    indexStart += indexCount;
  }
  if (!parts.length) return null;
  // One draw call, with disconnected surfaces in the original camera-frame coordinates.
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  if (parts.length > 1) {
    for (const part of parts) part.dispose();
  }
  if (!live) geometry.center();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshPhysicalMaterial({
    color: settings.color || '#aa84ed',
    vertexColors: geometry.hasAttribute('color'),
    metalness: 0.48,
    roughness: beads ? 0.24 : 0.36,
    clearcoat: 0.22,
    clearcoatRoughness: 0.42,
    envMapIntensity: 0.54,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.trackRanges = trackRanges;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Gesture ' + (settings.shape || 'ribbon');
  return mesh;
}

// Split the display mesh back into individually selectable glTF nodes for export.
function copyTrackGeometry(source, range) {
  const geometry = new THREE.BufferGeometry();
  for (const [key, attr] of Object.entries(source.attributes)) {
    const start = range.vertexStart * attr.itemSize;
    const end = start + range.vertexCount * attr.itemSize;
    geometry.setAttribute(key, new THREE.BufferAttribute(attr.array.slice(start, end), attr.itemSize, attr.normalized));
  }
  const indices = source.index.array.slice(range.indexStart, range.indexStart + range.indexCount);
  for (let i = 0; i < indices.length; i++) indices[i] -= range.vertexStart;
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.removeFromParent();
  mesh.geometry.dispose();
  mesh.material.dispose();
}

function makeStudio() {
  const studio = new THREE.Scene();
  studio.environmentIntensity = 0.31;
  studio.add(new THREE.HemisphereLight(0xfaf4ff, 0x574166, 0.66));
  const key = new THREE.DirectionalLight(0xffefed, 2.9);
  key.position.set(-3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -3.4, right: 3.4, top: 3.4, bottom: -3.4, near: 0.1, far: 15 });
  key.shadow.normalBias = 0.018;
  key.shadow.bias = -0.00035;
  key.shadow.radius = 2.5;
  const fill = new THREE.DirectionalLight(0xb8c7ff, 0.52);
  fill.position.set(4, 1, 1);
  const rim = new THREE.DirectionalLight(0xf8e2ff, 2.35);
  rim.position.set(1, 4, -3);
  studio.add(key, fill, rim);
  return studio;
}

function makeShadow() {
  const surface = document.createElement('canvas');
  surface.width = surface.height = 128;
  const ctx = surface.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(48,32,68,0.28)');
  gradient.addColorStop(0.4, 'rgba(65,44,80,0.17)');
  gradient.addColorStop(0.75, 'rgba(72,48,90,0.045)');
  gradient.addColorStop(1, 'rgba(72,48,90,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.visible = false;
  return shadow;
}

function placeShadow(shadow, mesh) {
  shadow.visible = Boolean(mesh);
  if (!mesh) return;
  const bounds = mesh.geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  shadow.position.set(0, bounds.min.y - 0.035, -0.12);
  shadow.scale.set(size.x * 1.13, Math.max(size.z, size.x * 0.42) * 1.12, 1);
}

function orient(camera) {
  camera.position.copy(cameraDirection).multiplyScalar(12);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
}

// Use the projected vertices to leave consistent breathing room around tall and wide gestures.
function fit(camera, mesh, width, height, live, padding = 0.76, shiftUp = 0) {
  const aspect = width / Math.max(1, height);
  let span = aspect >= 1 ? shortAxisSpan : shortAxisSpan / aspect;
  if (mesh && !live) {
    const positions = mesh.geometry.getAttribute('position');
    const view = camera.matrixWorldInverse.elements;
    let xMax = 0;
    let yMax = 0;
    for (let i = 0; i < positions.count; i += 2) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      xMax = Math.max(xMax, Math.abs(view[0] * x + view[4] * y + view[8] * z));
      yMax = Math.max(yMax, Math.abs(view[1] * x + view[5] * y + view[9] * z));
    }
    span = Math.max(yMax * 2, xMax * 2 / aspect, 0.12) / padding;
  }
  const offset = live ? 0 : span * shiftUp / height;
  camera.top = span / 2 - offset;
  camera.bottom = -span / 2 - offset;
  camera.left = -span * aspect / 2;
  camera.right = span * aspect / 2;
  camera.updateProjectionMatrix();
}

function makeWebGL(studio) {
  let renderer, generator, room;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(0xffffff, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    room = new RoomEnvironment();
    generator = new THREE.PMREMGenerator(renderer);
    const environment = generator.fromScene(room, 0.05);
    studio.environment = environment.texture;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    return {
      canvas: renderer.domElement,
      resize: (width, height) => renderer.setSize(width, height, false),
      render: (camera) => renderer.render(studio, camera),
      dispose() {
        studio.environment = null;
        environment.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      },
    };
  } catch {
    renderer?.dispose();
    renderer?.forceContextLoss();
    return null;
  } finally {
    generator?.dispose();
    room?.dispose();
  }
}

// Browsers with GPU acceleration disabled can still inspect and export the same 3D mesh.
function makeCanvasRenderer() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const key = new THREE.Vector3(-0.45, 0.64, 0.68).normalize();
  const rim = new THREE.Vector3(0.7, 0.46, -0.54).normalize();
  const mvp = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const half = new THREE.Vector3();
  const floor = new THREE.Vector3();
  let pixels;
  let depth;
  return {
    canvas,
    resize(width, height) {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      pixels = ctx.createImageData(canvas.width, canvas.height);
      depth = new Float32Array(canvas.width * canvas.height);
    },
    render(camera, mesh, shadow) {
      if (!pixels) return;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (!mesh) return;
      pixels.data.fill(0);
      depth.fill(Infinity);
      mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      heading.setFromMatrixColumn(camera.matrixWorld, 2).normalize();
      half.copy(heading).add(key).normalize();
      const geo = mesh.geometry;
      const pos = geo.getAttribute('position'), normals = geo.getAttribute('normal');
      const colors = geo.getAttribute('color');
      const paint = mesh.material.color.clone().convertLinearToSRGB();
      const vertices = new Float32Array(pos.count * 6);
      for (let i = 0; i < pos.count; i++) {
        point.fromBufferAttribute(pos, i).applyMatrix4(mvp);
        normal.fromBufferAttribute(normals, i);
        const light = 0.51 + 0.65 * Math.max(0, normal.dot(key)) + 0.23 * Math.max(0, normal.dot(rim));
        const specular = 64 * Math.max(0, normal.dot(half)) ** 25;
        const shade = colors ? colors.getX(i) ** 0.6 : 1;
        const v = i * 6;
        vertices[v] = (point.x + 1) * w / 2;
        vertices[v + 1] = (1 - point.y) * h / 2;
        vertices[v + 2] = point.z;
        vertices[v + 3] = 255 * paint.r * light * shade + specular;
        vertices[v + 4] = 255 * paint.g * light * shade + specular;
        vertices[v + 5] = 255 * paint.b * (light * 0.86 + 0.14) * shade + specular;
      }
      const idx = geo.index.array;
      const data = pixels.data;
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * 6, b = idx[i + 1] * 6, c = idx[i + 2] * 6;
        const ax = vertices[a], ay = vertices[a + 1];
        const bx = vertices[b], by = vertices[b + 1];
        const cx = vertices[c], cy = vertices[c + 1];
        const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (det > -0.00001) continue;
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
        const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
        const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
        const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const wa = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / det;
            const wb = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / det;
            const wc = 1 - wa - wb;
            if (wa < 0 || wb < 0 || wc < 0) continue;
            const z = wa * vertices[a + 2] + wb * vertices[b + 2] + wc * vertices[c + 2];
            const at = y * w + x;
            if (z >= depth[at]) continue;
            depth[at] = z;
            for (let j = 0; j < 3; j++) {
              data[at * 4 + j] = wa * vertices[a + 3 + j] + wb * vertices[b + 3 + j] + wc * vertices[c + 3 + j];
            }
            data[at * 4 + 3] = 255;
          }
        }
      }
      ctx.putImageData(pixels, 0, 0);
      if (shadow?.visible) {
        floor.copy(shadow.position).project(camera);
        const radius = shadow.scale.x * w / (camera.right - camera.left) * camera.zoom / 2;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.translate((floor.x + 1) * w / 2, (1 - floor.y) * h / 2);
        ctx.scale(Math.max(1, radius), Math.max(2, radius * 0.079));
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        gradient.addColorStop(0, 'rgba(51,35,65,.21)');
        gradient.addColorStop(1, 'rgba(51,35,65,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      }
    },
    dispose() { pixels = null; depth = null; },
  };
}

export function createScene(host, { onReady, onViewChange } = {}) {
  const studio = makeStudio();
  const renderer = makeWebGL(studio) ?? makeCanvasRenderer();
  const canvas = renderer.canvas;
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%' });
  host.append(canvas);
  const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 100);
  orient(camera);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.14;
  controls.enablePan = false;
  controls.enabled = false;
  controls.minZoom = 0.35;
  controls.maxZoom = 4;
  const shadow = makeShadow();
  studio.add(shadow);
  let mesh = null, previousPoints = null;
  let live = false, disposed = false, frame = 0;
  let width = 1, height = 1;

  function draw() {
    frame = 0;
    if (disposed) return;
    if (controls.enabled) controls.update();
    camera.updateMatrixWorld();
    if (onViewChange) {
      const worldToView = camera.matrixWorldInverse.elements;
      onViewChange(['X', 'Y', 'Z'].map((label, axis) => ({
        label, x: worldToView[4 * axis], y: worldToView[4 * axis + 1], z: worldToView[4 * axis + 2],
      })));
    }
    renderer.render(camera, mesh, shadow);
  }
  function invalidate() {
    if (!disposed && !frame) frame = requestAnimationFrame(draw);
  }
  function resetView() {
    controls.reset();
    controls.target.set(0, 0, 0);
    if (live) {
      camera.position.set(0, 0, 12);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    } else {
      orient(camera);
    }
    camera.zoom = 1;
    fit(camera, mesh, width, height, live, 0.76, 10);
    controls.update();
    invalidate();
  }
  function resize() {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    renderer.resize(width, height);
    fit(camera, mesh, width, height, live, 0.76, 10);
    invalidate();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  controls.addEventListener('change', invalidate);
  resize();
  queueMicrotask(() => { if (!disposed) onReady?.(); });

  return {
    setForm(points, settings, options = {}) {
      const nextLive = Boolean(options.live);
      const reframe = live !== nextLive || previousPoints !== points;
      const nextMesh = makeSculpture(points, settings, nextLive, options.paths);
      disposeMesh(mesh);
      mesh = nextMesh;
      if (mesh) studio.add(mesh);
      live = nextLive;
      placeShadow(shadow, live ? null : mesh);
      if (reframe && (!live || !previousPoints)) resetView();
      else if (live) {
        camera.position.set(0, 0, 12);
        camera.lookAt(0, 0, 0);
        camera.zoom = 1;
        fit(camera, mesh, width, height, true);
      }
      previousPoints = points;
      invalidate();
    },
    setMode(mode) {
      controls.enabled = mode === 'orbit';
      canvas.style.cursor = controls.enabled ? 'grab' : 'crosshair';
      canvas.style.touchAction = 'none';
      invalidate();
    },
    zoom(factor) {
      if (!(factor > 0)) return;
      camera.zoom = clamp(camera.zoom * factor, controls.minZoom, controls.maxZoom);
      camera.updateProjectionMatrix();
      invalidate();
    },
    resetView,
    setGrid(visible) {
      host.dataset.grid = String(Boolean(visible));
      host.classList.toggle('grid-hidden', !visible);
    },
    async exportGLB(name = 'Formtrace gesture') {
      if (!mesh) throw new Error('Draw a gesture or choose a preset before exporting.');
      // Keep an independent snapshot while the exporter encodes it asynchronously.
      const material = mesh.material.clone();
      const scene = new THREE.Scene();
      scene.name = name;
      const tracks = mesh.userData.trackRanges;
      for (const track of tracks) {
        const part = tracks.length === 1 ? mesh.geometry.clone() : copyTrackGeometry(mesh.geometry, track);
        const snapshot = new THREE.Mesh(part, material);
        snapshot.name = tracks.length === 1 ? name : 'Motion track ' + track.id;
        scene.add(snapshot);
      }
      try {
        const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
        const data = await new GLTFExporter().parseAsync(scene, { binary: true });
        const url = URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = String(name).replace(/[^a-z\d._-]+/gi, '-').replace(/\.glb$/i, '') + '.glb';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 15000);
      } finally {
        for (const snapshot of scene.children) snapshot.geometry.dispose();
        material.dispose();
      }
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener('change', invalidate);
      controls.dispose();
      disposeMesh(mesh);
      shadow.material.map.dispose();
      disposeMesh(shadow);
      renderer.dispose();
      canvas.remove();
    },
  };
}

export function renderPresetThumbnails(items) {
  // The CPU preview shares the exact geometry and needs no additional GPU contexts.
  const renderer = makeCanvasRenderer();
  const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 100);
  orient(camera);
  for (const { canvas, points, settings } of items) {
    if (!canvas) continue;
    const width = canvas.clientWidth || 140;
    const height = canvas.clientHeight || 88;
    renderer.resize(width, height);
    const mesh = makeSculpture(points, settings);
    fit(camera, mesh, width, height, false, 0.84);
    renderer.render(camera, mesh);
    canvas.width = renderer.canvas.width;
    canvas.height = renderer.canvas.height;
    canvas.getContext('2d').drawImage(renderer.canvas, 0, 0);
    disposeMesh(mesh);
  }
  renderer.dispose();
}
