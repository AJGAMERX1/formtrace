import './style.css';
import { mountIcons, icon } from './icons.js';
import { presets, attachMotion } from './motion.js';
import { createScene, renderPresetThumbnails } from './scene.js';

const $ = (selector) => document.querySelector(selector);
const host = $('#scene');
const palette = [
  ['Lilac', '#a482dd'],
  ['Periwinkle', '#8299e6'],
  ['Mint', '#75c5b2'],
  ['Apricot', '#eaaa67'],
  ['Rose', '#e88989'],
  ['Graphite', '#56565e'],
];
const descriptions = ['Folded ribbon', 'Coiled tube', 'Looped ribbon', 'Beaded curve'];

mountIcons();
$('#swatches').innerHTML = palette.map(([label, color]) =>
  '<button type="button" class="swatch" data-color="' + color + '" style="--swatch:' + color +
  '" aria-label="' + label + '" title="' + label + '" aria-pressed="false"></button>'
).join('');

$('#presets').innerHTML = presets.map((preset, i) =>
  '<button type="button" class="preset-card" data-preset="' + preset.id + '" aria-pressed="false">' +
  '<span class="preset-art"><canvas aria-hidden="true"></canvas></span><span class="preset-copy"><strong>' +
  preset.name + '</strong><small>' + descriptions[i] + '</small></span><span class="preset-status">' +
  icon('check') + '</span></button>'
).join('');

const guide = $('#guide');
$('#help').onclick = () => guide.showModal();
$('.dialog-close').onclick = () => guide.close();
guide.addEventListener('click', (event) => {
  if (event.target !== guide) return;
  const rect = guide.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) guide.close();
});

function stateFromPreset(preset) {
  return { id: preset.id, name: preset.name, points: preset.points, settings: { ...preset.settings } };
}

let current = stateFromPreset(presets[0]);
const past = [];
const future = [];
let sliderStart = null;
let drawing = false;
let mode = 'draw';
let scene;
let cleanupMotion;
let videoPanel;
let panelLoading = false;
let toastTimer;
let exporting = false;

function notify(message) {
  const toast = $('.toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function setStatus(text) {
  $('#status').textContent = text;
  $('.status-dot').style.background = drawing ? '#9866cb' : '';
}

function syncHistoryButtons() {
  $('#undo').disabled = drawing || past.length === 0;
  $('#redo').disabled = drawing || future.length === 0;
}

function remember(state) {
  past.push(state);
  if (past.length > 45) past.shift();
  future.length = 0;
  syncHistoryButtons();
}

function drawTrace(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(98 / Math.max(maxX - minX, 0.01), 34 / Math.max(maxY - minY, 0.01));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const path = points.map(([x, y], i) => (i ? 'L' : 'M') +
    (56 + (x - cx) * scale).toFixed(2) + ' ' + (21 - (y - cy) * scale).toFixed(2)).join(' ');
  $('#trace').setAttribute('d', path);
}

function syncControls() {
  const { settings } = current;
  for (const button of document.querySelectorAll('[data-shape]')) {
    button.setAttribute('aria-pressed', String(button.dataset.shape === settings.shape));
  }
  for (const button of document.querySelectorAll('[data-color]')) {
    button.setAttribute('aria-pressed', String(button.dataset.color === settings.color));
  }
  for (const button of document.querySelectorAll('[data-preset]')) {
    button.setAttribute('aria-pressed', String(button.dataset.preset === current.id));
  }
  $('#color-name').textContent = palette.find(([, c]) => c === settings.color)?.[0] ?? settings.color;
  for (const property of ['width', 'twist']) {
    const input = $('#' + property);
    const value = settings[property];
    input.value = value;
    input.style.setProperty('--progress', value + '%');
    input.setAttribute('aria-valuetext', value + ' percent');
    $('#' + property + '-value').value = value + '%';
  }
  $('#gesture-name').textContent = current.name;
  drawTrace(current.points);
  syncHistoryButtons();
}

function displayState() {
  scene.setForm(current.points, current.settings);
  syncControls();
}

function replaceState(next) {
  if (drawing) return;
  remember(current);
  current = next;
  displayState();
}

function setMode(value) {
  if (drawing) return;
  mode = value;
  $('.viewport').dataset.mode = value;
  scene.setMode(value);
  for (const button of document.querySelectorAll('button[data-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === value));
  }
  $('#instruction').textContent = value === 'draw' ? 'Drag in the viewport to draw' : 'Drag to orbit your form';
}

function stepHistory(from, to) {
  if (drawing || !from.length) return;
  to.push(current);
  current = from.pop();
  displayState();
}

const axisParts = Object.fromEntries([...document.querySelectorAll('[data-axis]')].map((axis) =>
  [axis.dataset.axis, { line: axis.querySelector('path'), label: axis.querySelector('text') }]
));

function updateAxes(axes) {
  for (const { label, x, y } of axes) {
    const part = axisParts[label];
    part.line.setAttribute('d', 'M29 27l' + (x * 18).toFixed(2) + ' ' + (-y * 18).toFixed(2));
    const length = Math.hypot(x, y) || 1;
    part.label.setAttribute('x', (29 + x * 18 + x / length * 5).toFixed(2));
    part.label.setAttribute('y', (27 - y * 18 - y / length * 5).toFixed(2));
  }
}

function setup() {
  scene = createScene(host, { onViewChange: updateAxes });
  displayState();
  setMode('draw');
  $('#capture-motion').onclick = async () => {
    if (drawing || panelLoading) return;
    panelLoading = true;
    try {
      if (!videoPanel) {
        const { setupVideoPanel } = await import('./video-panel.js');
        videoPanel = setupVideoPanel({
          onGesture(points, name) {
            replaceState({ ...current, id: null, name: name || 'Video gesture', points });
            setMode('orbit');
            scene.resetView();
            notify('Motion captured');
          },
        });
      }
      videoPanel.open();
    } catch (error) {
      console.error(error);
      notify('The motion capture panel could not open. Please reload and try again.');
    } finally {
      panelLoading = false;
    }
  };
  cleanupMotion = attachMotion(host, {
    canDraw: () => mode === 'draw' && !guide.open,
    onStart() {
      drawing = true;
      setStatus('Drawing');
      syncHistoryButtons();
      $('#export').disabled = true;
    },
    onPreview(points) {
      scene.setForm(points, current.settings, { live: true });
      drawTrace(points);
      $('#gesture-name').textContent = 'Drawing…';
    },
    onFinish(points) {
      drawing = false;
      replaceState({ ...current, points, id: null, name: 'Your gesture' });
      setStatus('Ready');
      $('#export').disabled = exporting;
    },
    onCancel() {
      drawing = false;
      displayState();
      setStatus('Ready');
      $('#export').disabled = exporting;
    },
  });
  for (const button of document.querySelectorAll('button[data-mode]')) {
    button.onclick = () => setMode(button.dataset.mode);
  }
  for (const button of document.querySelectorAll('[data-shape], [data-color]')) {
    const property = button.dataset.shape ? 'shape' : 'color';
    button.onclick = () => {
      if (current.settings[property] === button.dataset[property]) return;
      replaceState({ ...current, settings: { ...current.settings, [property]: button.dataset[property] } });
    };
  }
  for (const property of ['width', 'twist']) {
    const slider = $('#' + property);
    slider.addEventListener('input', () => {
      if (drawing) return;
      sliderStart ??= current;
      current = { ...current, settings: { ...current.settings, [property]: slider.valueAsNumber } };
      displayState();
    });
    slider.addEventListener('change', () => {
      if (sliderStart && sliderStart.settings[property] !== current.settings[property]) remember(sliderStart);
      sliderStart = null;
    });
  }
  for (const button of document.querySelectorAll('[data-preset]')) {
    button.onclick = () => {
      if (drawing) return;
      const preset = presets.find((item) => item.id === button.dataset.preset);
      if (preset.id !== current.id || Object.keys(preset.settings).some((k) => preset.settings[k] !== current.settings[k])) {
        replaceState(stateFromPreset(preset));
      }
      scene.resetView();
    };
  }
  $('#reset').onclick = () => {
    const defaults = (presets.find((item) => item.id === current.id) ?? presets[0]).settings;
    if (drawing) return;
    if (Object.keys(defaults).some((k) => defaults[k] !== current.settings[k])) {
      replaceState({ ...current, settings: { ...defaults } });
    }
    notify('Form controls reset');
  };
  $('#undo').onclick = () => stepHistory(past, future);
  $('#redo').onclick = () => stepHistory(future, past);
  $('#zoom-in').onclick = () => scene.zoom(1.18);
  $('#zoom-out').onclick = () => scene.zoom(1 / 1.18);
  $('#fit').onclick = () => scene.resetView();
  $('#export').onclick = async () => {
    if (drawing || exporting) return;
    const button = $('#export');
    exporting = true;
    button.disabled = true;
    button.lastElementChild.textContent = 'Exporting…';
    try {
      await scene.exportGLB('Formtrace-' + current.name.toLowerCase().replaceAll(' ', '-'));
      notify('GLB exported');
    } catch (error) {
      console.error(error);
      notify('Export failed. Please try again.');
    } finally {
      exporting = false;
      button.lastElementChild.textContent = 'Export object';
      button.disabled = drawing;
    }
  };
  document.addEventListener('keydown', (event) => {
    if (document.querySelector('dialog[open]') || drawing || event.altKey || event.target.matches('input, textarea, [contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) stepHistory(future, past);
        else stepHistory(past, future);
      }
      return;
    }
    if (key === 'd') setMode('draw');
    if (key === 'o') setMode('orbit');
    if (key === 'f') scene.resetView();
  });
  const canvases = document.querySelectorAll('.preset-art canvas');
  renderPresetThumbnails(presets.map((preset, i) => ({ ...preset, canvas: canvases[i] })));
}

try {
  setup();
} catch (error) {
  console.error(error);
  $('#status').textContent = 'Unavailable';
  $('#instruction').textContent = 'The 3D view could not start';
  host.innerHTML = '<p class="render-error">The preview could not be loaded. Reload the page to try again.</p>';
  for (const button of document.querySelectorAll('.workspace button, .library button, #export, #capture-motion')) button.disabled = true;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    videoPanel?.dispose();
    cleanupMotion?.();
    scene?.dispose();
  });
}
