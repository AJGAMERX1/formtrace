import './video-panel.css';
import { createVideoTracker } from './video-motion.js';
import { makePassScale } from './pass-colors.js';

const symbols = {
  trails: '<path d="M2 16c6 0 4-11 10-11s4 10 10 10M2 20c7 0 6-9 10-9s4 8 10 8"/>',
  region: '<path d="M9 3H4v5m11-5h5v5m0 8v5h-5m-6 0H4v-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  heatmap: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m6-18v18M3 9h18M3 15h18"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  upload: '<path d="M12 15V3m-4 4 4-4 4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
  camera: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3z"/>',
  play: '<path d="m8 4 11 8-11 8z"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zm-8 4.5 8 4.5 8-4.5M12 12v9"/>',
};

function glyph(name) {
  return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + symbols[name] + '</svg>';
}

function clock(seconds) {
  const value = Math.floor(Math.max(0, seconds || 0));
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
}

const CAPTURE_DESCRIPTION = 'Keep the camera still while birds or other subjects move through the frame. Turn their paths into a 3D object. Video stays on your device.';

function plural(number, singular, many = singular + 's') {
  return number + ' ' + (number === 1 ? singular : many);
}

function paintSavedMap(canvas, map) {
  const { columns, rows, counts } = map;
  const scale = makePassScale(map.maxPasses);
  const ratio = map.aspectRatio || columns / rows;
  canvas.width = Math.round(960 * Math.min(1, ratio));
  canvas.height = Math.round(canvas.width / ratio);
  const brush = canvas.getContext('2d');
  const dx = canvas.width / columns, dy = canvas.height / rows;
  brush.fillStyle = '#2e2b35';
  brush.fillRect(0, 0, canvas.width, canvas.height);
  const inset = .13 * Math.min(dx, dy, 7);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const passes = counts[y * columns + x];
      brush.fillStyle = passes ? scale.color(passes) : '#393640';
      brush.fillRect(x * dx + inset, y * dy + inset, dx - inset, dy - inset);
    }
  }
}

function setupAreaSelection(dialog) {
  const find = selector => dialog.querySelector(selector);
  const stage = find('.capture-stage');
  const tools = find('.capture-region-tools');
  const select = find('#capture-area-preset');
  const button = find('#capture-area-select');
  const resetButton = find('#capture-area-reset');
  const outline = find('#capture-region-outline');
  const instruction = find('#capture-area-instruction');
  const start = find('#capture-start');
  let region = null;
  let preset = 'full';
  let editing = false;
  let drag = null;

  function paint(bounds) {
    outline.hidden = !bounds;
    if (!bounds) return;
    Object.assign(outline.style, {
      left: (100 * bounds.x) + '%',
      top: (100 * bounds.y) + '%',
      width: (100 * bounds.width) + '%',
      height: (100 * bounds.height) + '%',
    });
  }

  function refresh() {
    select.value = editing ? 'custom' : preset;
    button.querySelector('span').textContent = editing ? 'Cancel' : 'Select area';
    button.setAttribute('aria-pressed', String(editing));
    resetButton.hidden = !region || editing;
    instruction.hidden = !editing;
    start.disabled = editing;
    stage.classList.toggle('is-selecting', editing);
    paint(region);
  }

  function endDrag() {
    const id = drag?.id;
    drag = null;
    if (id !== undefined && stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
  }

  function cancel(focus = true) {
    if (!editing) return false;
    endDrag();
    editing = false;
    refresh();
    if (focus) button.focus();
    return true;
  }

  function apply(next, name) {
    endDrag();
    editing = false;
    region = next;
    preset = name;
    refresh();
  }

  function begin() {
    if (tools.hidden) return;
    editing = true;
    instruction.textContent = 'Drag across the preview to select the area to track. Press Esc to cancel.';
    refresh();
  }

  button.onclick = () => { if (!cancel()) begin(); };
  resetButton.onclick = () => { apply(null, 'full'); select.focus(); };
  select.onchange = () => {
    if (select.value === 'custom') { begin(); return; }
    const choice = select.value;
    apply(choice === 'full' ? null : { x: 0, y: choice === 'upper' ? 0 : .5, width: 1, height: .5 }, choice);
  };

  function point(event) {
    const box = stage.getBoundingClientRect();
    const unit = n => Math.min(1, Math.max(0, n));
    return { x: unit((event.clientX - box.left) / box.width), y: unit((event.clientY - box.top) / box.height) };
  }

  function rectangle(event) {
    const end = point(event);
    return { x: Math.min(drag.x, end.x), y: Math.min(drag.y, end.y),
      width: Math.abs(drag.x - end.x), height: Math.abs(drag.y - end.y) };
  }

  stage.addEventListener('pointerdown', event => {
    if (!editing || drag || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    drag = { ...point(event), id: event.pointerId };
    stage.setPointerCapture(event.pointerId);
    paint(rectangle(event));
  });
  stage.addEventListener('pointermove', event => {
    if (event.pointerId !== drag?.id) return;
    event.preventDefault();
    paint(rectangle(event));
  });
  stage.addEventListener('pointerup', event => {
    if (event.pointerId !== drag?.id) return;
    const bounds = rectangle(event);
    const box = stage.getBoundingClientRect();
    endDrag();
    if (bounds.width * box.width < 5 || bounds.height * box.height < 5) {
      paint(region);
      instruction.textContent = 'Drag diagonally across the preview to make a larger selection.';
      return;
    }
    apply(bounds, 'custom');
    button.focus({ preventScroll: true });
  });
  stage.addEventListener('lostpointercapture', event => {
    if (event.pointerId === drag?.id) { drag = null; paint(region); }
  });

  return {
    get bounds() { return region; },
    get editing() { return editing; },
    cancel,
    reset() { apply(null, 'full'); },
    showSaved(bounds) { apply(bounds || null, bounds ? 'custom' : 'full'); },
    setEditable(available) {
      if (!available) cancel(false);
      tools.hidden = !available;
    },
  };
}

export function setupVideoPanel({ onGesture }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'motion-capture';
  dialog.className = 'capture-dialog';
  dialog.setAttribute('aria-labelledby', 'capture-title');
  dialog.setAttribute('aria-describedby', 'capture-description');
  dialog.innerHTML = `
    <header class="capture-heading">
      <h2 id="capture-title">Capture motion</h2>
      <button id="capture-close" type="button" class="capture-close" aria-label="Close capture">${glyph('close')}</button>
    </header>
    <p id="capture-description">${CAPTURE_DESCRIPTION}</p>
    <div class="capture-picker">
      <button id="capture-upload" class="capture-choice" type="button" autofocus>
        <span class="capture-symbol">${glyph('upload')}</span><strong>Upload a video</strong><small>Choose a clip from your device.</small>
      </button>
      <button id="capture-camera" class="capture-choice" type="button">
        <span class="capture-symbol">${glyph('camera')}</span><strong>Use camera</strong><small>Capture a live gesture.</small>
      </button>
      <div class="capture-sample-row">
        <button id="capture-sample" type="button">${glyph('play')}Try flock footage</button>
        <small><a href="https://commons.wikimedia.org/wiki/File:Flying_Birds_1_2022-12-05.webm" target="_blank" rel="noopener noreferrer">Footage by Fastily</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a></small>
      </div>
    </div>
    <input type="file" id="capture-file" accept="video/*" hidden />
    <section class="capture-session" aria-label="Capture preview" hidden>
      <div class="capture-source-info">
        <strong id="capture-source-name"></strong><span id="capture-duration"></span>
      </div>
      <div class="capture-view-modes" role="group" aria-label="Motion overlay" hidden>
        <button type="button" data-overlay-mode="trails" aria-pressed="true">${glyph('trails')}Trails</button>
        <button type="button" data-overlay-mode="heatmap" aria-pressed="false">${glyph('heatmap')}Pass heat map</button>
      </div>
      <div class="capture-frame" hidden>
        <div class="capture-stage">
          <video muted playsinline id="capture-preview" aria-label="Source video preview"></video>
          <canvas id="capture-trail" aria-hidden="true"></canvas>
          <canvas id="capture-saved-map" aria-hidden="true" hidden></canvas>
          <span id="capture-region-outline" aria-hidden="true" hidden></span>
          <span class="capture-cell" aria-hidden="true" hidden></span>
        </div>
      </div>
      <div class="capture-region-tools" hidden>
        <div class="capture-region-set">
          <label for="capture-area-preset">Tracking area</label>
          <select id="capture-area-preset">
            <option value="full">Full frame</option><option value="upper">Upper half</option>
            <option value="lower">Lower half</option><option value="custom">Custom selection</option>
          </select>
          <button id="capture-area-select" type="button" aria-pressed="false">${glyph('region')}<span>Select area</span></button>
          <button id="capture-area-reset" type="button" hidden>Full frame</button>
        </div>
        <p id="capture-area-instruction" role="status" hidden></p>
      </div>
      <div class="capture-map-details" hidden>
        <div class="capture-map-key">
          <span class="capture-legend-title">Passes per cell</span>
          <ul class="capture-legend" aria-label="Pass count color scale"></ul>
        </div>
        <p class="capture-map-note">Each time a track enters a cell, it adds one pass. Returning adds another. Pausing keeps the count steady. The color scale expands as the peak rises.</p>
        <p id="capture-inspect-tip">Tap a cell or use the arrow keys on the map to read its count.</p>
        <output id="capture-cell-value" aria-live="polite"></output>
      </div>
      <div class="capture-feedback">
        <p id="capture-status" role="status"></p>
        <span id="capture-count"></span>
      </div>
      <p class="capture-track-note" hidden>Tracks are observed movement segments. They can split or merge when subjects overlap.</p>
      <progress id="capture-progress" aria-label="Video tracking progress" max="1" hidden></progress>
      <div class="capture-actions">
        <button id="capture-source" type="button" class="capture-secondary">Choose another source</button>
        <div class="capture-action-group">
          <button id="capture-start" type="button" class="capture-primary" hidden>${glyph('play')}<span>Track motion</span></button>
          <button id="capture-finish" type="button" class="capture-primary" hidden>${glyph('stop')}Finish tracking</button>
          <button id="capture-apply" type="button" class="capture-primary" hidden>${glyph('cube')}Create object</button>
        </div>
      </div>
    </section>`;
  document.body.append(dialog);

  const find = selector => dialog.querySelector(selector);
  const picker = find('.capture-picker');
  const session = find('.capture-session');
  const input = find('#capture-file');
  const preview = find('#capture-preview');
  const overlay = find('#capture-trail');
  const frame = find('.capture-frame');
  const stage = find('.capture-stage');
  const status = find('#capture-status');
  const count = find('#capture-count');
  const durationLabel = find('#capture-duration');
  const progress = find('#capture-progress');
  const start = find('#capture-start');
  const finish = find('#capture-finish');
  const apply = find('#capture-apply');
  const choose = find('#capture-source');
  const modes = find('.capture-view-modes');
  const modeButtons = [...modes.querySelectorAll('button')];
  const details = find('.capture-map-details');
  const legend = find('.capture-legend');
  let legendPeak = -1;
  const savedMap = find('#capture-saved-map');
  const cellOutline = find('.capture-cell');
  const cellValue = find('#capture-cell-value');
  const sourceInfo = find('.capture-source-info');
  const actions = find('.capture-actions');
  const area = setupAreaSelection(dialog);
  let result = null;
  let heatmap = null;
  let trackCount = 0;
  let overlayMode = 'trails';
  let selectedCell = null;
  let sampleController = null;
  let tracker = null;
  let epoch = 0;
  let source = null;
  let phase = 'idle';
  let loaded = false;
  let path = null;
  let sourceDuration = 0;

  function release() {
    ++epoch;
    area.reset();
    sampleController?.abort();
    sampleController = null;
    tracker?.dispose();
    tracker = null;
    path = null;
    result = null;
    heatmap = null;
    trackCount = 0;
    selectedCell = null;
    overlayMode = 'trails';
    source = null;
    loaded = false;
    sourceDuration = 0;
    phase = 'idle';
    input.value = '';
  }

  function showPicker() {
    release();
    find('#capture-title').textContent = 'Capture motion';
    find('#capture-description').textContent = CAPTURE_DESCRIPTION;
    picker.hidden = false;
    session.hidden = true;
    frame.hidden = true;
    if (dialog.open) find('#capture-upload').focus();
  }

  function meshSummary(capture) {
    const included = capture.paths?.length;
    if (included && included < capture.trackCount) {
      return 'The 3D object includes the ' + included + ' strongest tracks. The map includes all passes.';
    }
    return '';
  }

  function updateLegend() {
    const peak = heatmap?.maxPasses || 0;
    if (peak === legendPeak) return;
    legendPeak = peak;
    const { stops } = makePassScale(peak);
    legend.innerHTML = stops.map(({ count, color }) =>
      '<li><i data-count="' + count + '" data-peak="' + (count === peak) + '" style="--pass-color:' + color + '"></i><span>' + count + '</span></li>'
    ).join('');
    legend.style.setProperty('--pass-gradient', 'linear-gradient(90deg, ' + stops.map(stop => stop.color).join(', ') + ')');
    legend.setAttribute('aria-label', 'Pass count color scale from ' + stops[0].count + ' to ' + stops.at(-1).count);
  }

  function displayCounts() {
    updateLegend();
    const tracks = plural(trackCount, 'motion track');
    const peak = heatmap ? 'Peak ' + plural(heatmap.maxPasses || 0, 'pass', 'passes') : '';
    count.textContent = (phase === 'ready' || phase === 'loading') ? '' : [tracks, peak].filter(Boolean).join(' · ');
    if (selectedCell && heatmap) showCell(...selectedCell);
  }

  function showCell(x, y) {
    if (!heatmap?.counts || overlayMode !== 'heatmap') return;
    const { columns, rows, counts } = heatmap;
    x = Math.max(0, Math.min(columns - 1, x));
    y = Math.max(0, Math.min(rows - 1, y));
    selectedCell = [x, y];
    Object.assign(cellOutline.style, {
      left: (100 * x / columns) + '%', top: (100 * y / rows) + '%',
      width: (100 / columns) + '%', height: (100 / rows) + '%',
    });
    cellOutline.hidden = false;
    const passes = counts[y * columns + x];
    const label = 'Column ' + (x + 1) + ', row ' + (y + 1) + ' · ' + passes + (passes === 1 ? ' pass' : ' passes');
    if (cellValue.textContent !== label) cellValue.textContent = label;
  }

  function syncOverlay() {
    updateLegend();
    const saved = source === 'saved';
    const showDetails = overlayMode === 'heatmap' && !frame.hidden;
    area.setEditable(!saved && loaded && (phase === 'ready' || phase === 'error'));
    details.hidden = !showDetails;
    find('.capture-track-note').hidden = !showDetails && phase !== 'complete';
    modes.hidden = frame.hidden || saved;
    modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.overlayMode === overlayMode)));
    sourceInfo.hidden = saved;
    savedMap.hidden = !saved;
    preview.hidden = overlay.hidden = saved;
    actions.hidden = saved;
    stage.tabIndex = showDetails ? 0 : -1;
    if (showDetails) {
      stage.setAttribute('role', 'group');
      stage.setAttribute('aria-label', 'Pass heat map grid');
      stage.setAttribute('aria-describedby', 'capture-inspect-tip');
    } else {
      stage.removeAttribute('role');
      stage.removeAttribute('aria-label');
      stage.removeAttribute('aria-describedby');
    }
    if (!showDetails || !selectedCell) {
      cellOutline.hidden = true;
      cellValue.textContent = '';
    }
  }

  function selectOverlay(mode) {
    overlayMode = mode;
    selectedCell = null;
    tracker?.setOverlayMode(mode);
    syncOverlay();
  }

  for (const button of modeButtons) button.onclick = () => selectOverlay(button.dataset.overlayMode);
  stage.addEventListener('click', event => {
    if (!heatmap || overlayMode !== 'heatmap' || area.editing) return;
    const box = stage.getBoundingClientRect();
    showCell(Math.floor((event.clientX - box.left) * heatmap.columns / box.width),
      Math.floor((event.clientY - box.top) * heatmap.rows / box.height));
  });
  stage.addEventListener('keydown', event => {
    if (!heatmap || overlayMode !== 'heatmap' || area.editing) return;
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = offsets[event.key];
    if (!step) return;
    event.preventDefault();
    const [x, y] = selectedCell || [Math.floor(heatmap.columns / 2), Math.floor(heatmap.rows / 2)];
    showCell(x + step[0], y + step[1]);
  });

  function updateControls() {
    start.hidden = phase !== 'ready' && !(phase === 'error' && loaded);
    start.querySelector('span').textContent = phase === 'error' ? 'Try tracking again'
      : source === 'camera' ? 'Start tracking' : 'Track motion';
    finish.hidden = source !== 'camera' || phase !== 'tracking';
    apply.hidden = !path?.length;
    progress.hidden = phase !== 'tracking' || source !== 'file';
    status.classList.toggle('capture-error', phase === 'error');
    syncOverlay();
  }

  function sizePreview() {
    if (preview.videoWidth && preview.videoHeight) {
      stage.style.setProperty('--video-ratio', String(preview.videoWidth / preview.videoHeight));
    }
  }

  function setPhase(next, message) {
    if (!source || next === 'idle') return;
    phase = next;
    if (phase === 'ready') {
      loaded = true;
      frame.hidden = false;
      sizePreview();
    }
    if (phase === 'tracking') {
      frame.hidden = false;
      progress.value = 0;
      count.textContent = '';
    }
    const defaults = {
      loading: source === 'camera' ? 'Opening the camera…' : 'Opening the video…',
      ready: source === 'camera' ? 'Frame the movement, then start tracking.' : 'Ready to track this clip.',
      tracking: source === 'camera' ? 'Tracking movement. Finish when your gesture is complete.' : 'Tracking movement in the clip…',
      complete: 'Your path is ready.',
      error: 'Tracking could not finish. Try another source.',
    };
    status.textContent = message || defaults[phase] || '';
    updateControls();
  }

  function showError(error) {
    setPhase('error', error?.message || 'Unable to read this video source.');
  }

  // Ignore callbacks from a previous source, including late camera permission results.
  function listen(token, callback) {
    return (...args) => {
      if (token === epoch && dialog.open) callback(...args);
    };
  }

  async function run(operation) {
    const token = epoch;
    try {
      await operation();
    } catch (error) {
      if (epoch === token && dialog.open) showError(error);
    }
  }

  function beginSource(kind, file, isSample = false) {
    release();
    const token = epoch;
    source = kind;
    overlayMode = isSample ? 'heatmap' : 'trails';
    picker.hidden = true;
    session.hidden = false;
    frame.hidden = true;
    durationLabel.textContent = '';
    count.textContent = '';
    find('#capture-source-name').textContent = isSample ? 'Flock footage' : file?.name || 'Live camera';
    setPhase('loading', isSample ? 'Loading flock footage…' : '');
    choose.focus();
    run(async () => {
      let clip = file;
      if (isSample) {
        sampleController = new AbortController();
        const url = new URL('../media/flying-birds.webm', import.meta.url);
        const response = await fetch(url, { signal: sampleController.signal });
        if (!response.ok) throw new Error('The flock footage could not be loaded. Choose another source to retry.');
        const blob = await response.blob();
        if (token !== epoch) return;
        clip = new File([blob], 'Flying birds.webm', { type: 'video/webm' });
        sampleController = null;
      }
      tracker = createVideoTracker({
        video: preview,
        overlay,
        onStatus: listen(token, state => {
          if (Number.isFinite(state.duration) && state.duration > 0) {
            sourceDuration = state.duration;
            if (kind === 'file') durationLabel.textContent = clock(sourceDuration);
          }
          setPhase(state.phase, state.message);
        }),
        onProgress: listen(token, state => {
          if (typeof state.fraction === 'number') progress.value = Math.min(1, Math.max(0, state.fraction));
          durationLabel.textContent = clock(state.elapsed) + (kind === 'file' && sourceDuration ? ' / ' + clock(sourceDuration) : '');
          heatmap = state.heatmap || null;
          trackCount = state.trackCount || 0;
          displayCounts();
        }),
        onComplete: listen(token, (points, meta) => {
          path = points;
          if (!path?.length) {
            showError(new Error('No movement was found. Try a clip with a moving subject and a steady camera.'));
            return;
          }
          heatmap = meta.heatmap;
          trackCount = meta.trackCount;
          result = { paths: meta.paths, heatmap, trackCount };
          setPhase('complete', meshSummary(result) || 'Ready to create your object.');
          displayCounts();
          apply.focus();
        }),
        onError: listen(token, showError),
      });
      if (kind === 'camera') await tracker.startCamera();
      else await tracker.loadFile(clip);
      if (isSample && token === epoch && loaded) tracker.setOverlayMode(overlayMode);
    });
  }

  const close = () => {
    release();
    if (dialog.open) dialog.close();
  };
  find('#capture-close').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!area.cancel()) close(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  find('#capture-upload').onclick = () => input.click();
  find('#capture-camera').onclick = () => beginSource('camera');
  find('#capture-sample').onclick = () => beginSource('file', null, true);
  input.onchange = () => {
    const file = input.files[0];
    if (file && dialog.open) beginSource('file', file);
  };
  preview.addEventListener('resize', sizePreview);
  choose.onclick = showPicker;
  start.onclick = () => {
    if (!tracker || area.editing || (phase !== 'ready' && phase !== 'error')) return;
    path = null;
    heatmap = null;
    selectedCell = null;
    trackCount = 0;
    setPhase('tracking');
    const token = epoch;
    run(async () => {
      tracker.setRegion(area.bounds);
      const started = await tracker.startTracking();
      if (started === false && token === epoch && phase === 'tracking') {
        loaded = false;
        setPhase('error', 'Choose another source to start tracking again.');
        choose.focus();
      }
    });
  };
  finish.onclick = () => {
    if (!tracker || phase !== 'tracking') return;
    run(() => tracker.finishTracking());
  };
  apply.onclick = () => {
    if (!path?.length) return;
    const points = path;
    const name = source === 'camera' ? 'Camera motion' : 'Video motion';
    try {
      onGesture(points, name, result);
      close();
    } catch (error) {
      showError(error);
    }
  };

  return {
    open() {
      if (dialog.open) return;
      showPicker();
      dialog.showModal();
    },
    openResult(capture) {
      const map = capture?.heatmap;
      if (!map?.counts || !map.columns || !map.rows) return;
      release();
      source = 'saved';
      phase = 'complete';
      overlayMode = 'heatmap';
      heatmap = map;
      trackCount = capture.trackCount || capture.paths?.length || 0;
      find('#capture-title').textContent = 'Pass heat map';
      find('#capture-description').textContent = 'The grid matches the original camera view. Warmer colors mark areas with more passes.';
      picker.hidden = true;
      session.hidden = false;
      frame.hidden = false;
      status.textContent = meshSummary(capture);
      progress.hidden = true;
      stage.style.setProperty('--video-ratio', String(map.aspectRatio || map.columns / map.rows));
      area.showSaved(map.region);
      paintSavedMap(savedMap, map);
      displayCounts();
      syncOverlay();
      if (!dialog.open) dialog.showModal();
      find('#capture-close').focus();
    },
    close,
    dispose() {
      close();
      dialog.remove();
    },
  };
}
