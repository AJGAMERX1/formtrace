const TAU = 2 * Math.PI;
const VIEW_SPAN = 5.2;

function fitPath(points, span = 4.4) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  const size = max.map((end, axis) => end - min[axis]);
  const center = size.map((extent, axis) => min[axis] + extent / 2);
  const scale = span / Math.max(...size, 0.15);
  return points.map((point) => point.map((n, axis) => (n - center[axis]) * scale));
}

function makePath(position, { tilt = 0, closed = false } = {}) {
  const points = Array.from({ length: 181 }, (_, index) => {
    const [x, y, z] = position(index / 180);
    return [
      x * Math.cos(tilt) - y * Math.sin(tilt),
      x * Math.sin(tilt) + y * Math.cos(tilt),
      z,
    ];
  });
  if (closed) points[points.length - 1] = [...points[0]];
  return fitPath(points);
}

export const presets = [
  {
    id: 'silk-loop',
    name: 'Silk loop',
    settings: { shape: 'ribbon', color: '#a482dd', width: 60, twist: 46 },
    points: makePath((u) => {
      const t = u * TAU;
      return [
        1.20 * Math.sin(t) + 1.80 * Math.sin(2 * t) + 0.20 * Math.cos(3 * t),
        0.76 * Math.cos(t) - 1.31 * Math.cos(2 * t),
        0.98 * Math.sin(3 * t) + 0.21 * Math.cos(t),
      ];
    }, { tilt: 0.27, closed: true }),
  },
  {
    id: 'helix',
    name: 'Helix',
    settings: { shape: 'tube', color: '#eaaa67', width: 49, twist: 24 },
    points: makePath((u) => {
      const t = TAU * (2.65 * u + 0.04);
      return [
        4.4 * (u - 0.5) + 0.33 * Math.cos(t),
        0.95 * Math.sin(t),
        0.95 * Math.cos(t),
      ];
    }, { tilt: 0.26 }),
  },
  {
    id: 'orbit-knot',
    name: 'Orbit knot',
    settings: { shape: 'ribbon', color: '#75c5b2', width: 52, twist: 65 },
    points: makePath((u) => {
      const t = u * TAU;
      return [
        2.17 * Math.sin(t),
        0.91 * Math.sin(2 * t) + 0.22 * Math.cos(t),
        0.80 * Math.cos(t) - 0.30 * Math.sin(2 * t),
      ];
    }, { tilt: -0.37, closed: true }),
  },
  {
    id: 'pulse-wave',
    name: 'Pulse wave',
    settings: { shape: 'beads', color: '#e88989', width: 63, twist: 34 },
    points: makePath((u) => {
      const t = TAU * (1.60 * u - 0.11);
      return [
        (u - 0.5) * 4.4,
        Math.sin(t) * (0.63 + 0.37 * Math.sin(Math.PI * u)),
        0.5 * Math.cos(t),
      ];
    }, { tilt: 0.14 }),
  },
];

// Keep samples evenly spaced along long strokes so a slower part of the
// gesture does not consume most of the geometry's detail.
function resample(points, limit) {
  if (points.length <= limit) return points.slice();
  const distances = [0];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    distances.push(distances[i - 1] + Math.hypot(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]));
  }
  const step = distances.at(-1) / (limit - 1);
  const result = [points[0]];
  let j = 1;
  for (let i = 1; i < limit - 1; i += 1) {
    const target = i * step;
    while (j < distances.length - 1 && distances[j] < target) j += 1;
    const fraction = (target - distances[j - 1]) / Math.max(1e-9, distances[j] - distances[j - 1]);
    result.push(points[j - 1].map((n, axis) => n + (points[j][axis] - n) * fraction));
  }
  result.push(points.at(-1));
  return result;
}

const CONTROL_SELECTOR = 'button, a, input, select, textarea, [role="button"], [role="slider"], [contenteditable="true"], [data-no-draw]';

export function attachMotion(host, { canDraw, onStart, onPreview, onFinish, onCancel }) {
  let stroke = null;
  let frame = null;
  const previousTouchAction = host.style.touchAction;
  host.style.touchAction = 'none';

  function xy(event) {
    const { rect, unitsPerPixel } = stroke;
    const x = (event.clientX - rect.left - rect.width / 2) * unitsPerPixel;
    const y = (rect.top + rect.height / 2 - event.clientY) * unitsPerPixel;
    return [x, y];
  }

  function append(event) {
    const [x, y] = xy(event);
    const prev = stroke.points.at(-1);
    const distance = Math.hypot(x - prev[0], y - prev[1]);
    if (distance < 2 * stroke.unitsPerPixel) return;

    const elapsed = Math.max(4, event.timeStamp - stroke.time);
    const velocity = (distance / stroke.unitsPerPixel) / elapsed;
    const smoothing = 1 - Math.exp(-elapsed / 64);
    stroke.velocity += (Math.min(velocity, 4) - stroke.velocity) * smoothing;
    stroke.length += distance;
    stroke.time = event.timeStamp;

    // Travel gives a stroke its arc, while faster gestures rise in depth.
    const amplitude = Math.min(1, stroke.length * 1.2);
    const targetZ = 0.46 * Math.sin(stroke.length * 1.17)
      + amplitude * 0.70 * Math.tanh(stroke.velocity - 0.6);
    const easing = 1 - Math.exp(-distance * 5);
    stroke.points.push([x, y, prev[2] + (targetZ - prev[2]) * easing]);
    if (stroke.points.length >= 1024) stroke.points = resample(stroke.points, 512);
  }

  function finish(cancelled) {
    const ended = stroke;
    stroke = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (host.hasPointerCapture(ended.id)) host.releasePointerCapture(ended.id);
    if (cancelled || ended.length < 6 * ended.unitsPerPixel || ended.points.length < 2) {
      onCancel?.();
      return;
    }
    onFinish?.(fitPath(resample(ended.points, 240)));
  }

  function down(event) {
    if (stroke || !canDraw() || !event.isPrimary || event.button !== 0) return;
    if (event.target.closest?.(CONTROL_SELECTOR)) return;
    const rect = host.getBoundingClientRect();
    const shortSide = Math.min(rect.width, rect.height);
    if (!shortSide) return;
    event.preventDefault();
    stroke = {
      id: event.pointerId, rect, unitsPerPixel: VIEW_SPAN / shortSide,
      length: 0, velocity: 0.6, time: event.timeStamp, points: [],
    };
    stroke.points.push([...xy(event), 0]);
    host.setPointerCapture(event.pointerId);
    onStart?.();
  }

  function move(event) {
    if (event.pointerId !== stroke?.id) return;
    if (!canDraw()) return finish(true);
    event.preventDefault();
    const samples = event.getCoalescedEvents?.() || [];
    for (const sample of samples) append(sample);
    append(event);
    if (frame === null && stroke.points.length >= 2) {
      frame = requestAnimationFrame(() => {
        frame = null;
        if (stroke) onPreview?.(resample(stroke.points, 240));
      });
    }
  }

  function up(event) {
    if (event.pointerId !== stroke?.id) return;
    append(event);
    finish(!canDraw());
  }

  function cancel(event) {
    if (event.pointerId === stroke?.id) finish(true);
  }

  function abort() {
    if (stroke) finish(true);
  }

  host.addEventListener('pointerdown', down);
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', cancel);
  host.addEventListener('lostpointercapture', cancel);
  window.addEventListener('blur', abort);
  window.addEventListener('resize', abort);

  return () => {
    abort();
    host.removeEventListener('pointerdown', down);
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerup', up);
    host.removeEventListener('pointercancel', cancel);
    host.removeEventListener('lostpointercapture', cancel);
    window.removeEventListener('blur', abort);
    window.removeEventListener('resize', abort);
    host.style.touchAction = previousTouchAction;
  };
}
