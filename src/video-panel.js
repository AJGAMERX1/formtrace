import './video-panel.css';
import { createVideoTracker } from './video-motion.js';

const symbols = {
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
    <p id="capture-description">Keep the camera still and move one subject through the frame. Its movement becomes the path of your 3D object. Video stays on your device.</p>
    <div class="capture-picker">
      <button id="capture-upload" class="capture-choice" type="button" autofocus>
        <span class="capture-symbol">${glyph('upload')}</span><strong>Upload a video</strong><small>Choose a clip from your device.</small>
      </button>
      <button id="capture-camera" class="capture-choice" type="button">
        <span class="capture-symbol">${glyph('camera')}</span><strong>Use camera</strong><small>Capture a live gesture.</small>
      </button>
    </div>
    <input type="file" id="capture-file" accept="video/*" hidden />
    <section class="capture-session" aria-label="Capture preview" hidden>
      <div class="capture-source-info">
        <strong id="capture-source-name"></strong><span id="capture-duration"></span>
      </div>
      <div class="capture-frame" hidden>
        <div class="capture-stage">
          <video muted playsinline id="capture-preview" aria-label="Source video preview"></video>
          <canvas id="capture-trail" aria-hidden="true"></canvas>
        </div>
      </div>
      <div class="capture-feedback">
        <p id="capture-status" role="status"></p>
        <span id="capture-count"></span>
      </div>
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
  let tracker = null;
  let epoch = 0;
  let source = null;
  let phase = 'idle';
  let loaded = false;
  let path = null;
  let sourceDuration = 0;

  function release() {
    ++epoch;
    tracker?.dispose();
    tracker = null;
    path = null;
    source = null;
    loaded = false;
    sourceDuration = 0;
    phase = 'idle';
    input.value = '';
  }

  function showPicker() {
    release();
    picker.hidden = false;
    session.hidden = true;
    frame.hidden = true;
    if (dialog.open) find('#capture-upload').focus();
  }

  function updateControls() {
    start.hidden = phase !== 'ready' && !(phase === 'error' && loaded);
    start.querySelector('span').textContent = phase === 'error' ? 'Try tracking again'
      : source === 'camera' ? 'Start tracking' : 'Track motion';
    finish.hidden = source !== 'camera' || phase !== 'tracking';
    apply.hidden = !path?.length;
    progress.hidden = phase !== 'tracking' || source !== 'file';
    status.classList.toggle('capture-error', phase === 'error');
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
      ready: source === 'camera' ? 'Position your subject, then start tracking.' : 'Ready to track this clip.',
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

  function beginSource(kind, file) {
    release();
    const token = epoch;
    source = kind;
    picker.hidden = true;
    session.hidden = false;
    frame.hidden = true;
    durationLabel.textContent = '';
    count.textContent = '';
    find('#capture-source-name').textContent = file?.name || 'Live camera';
    setPhase('loading');
    choose.focus();
    run(async () => {
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
          count.textContent = state.count ? state.count + ' samples' : '';
        }),
        onComplete: listen(token, (points, meta) => {
          path = points;
          if (!path?.length) {
            showError(new Error('No movement was found. Try a clip with a moving subject and a steady camera.'));
            return;
          }
          count.textContent = meta?.count ? meta.count + ' samples' : '';
          setPhase('complete', 'Your motion path is ready.');
          apply.focus();
        }),
        onError: listen(token, showError),
      });
      if (kind === 'camera') await tracker.startCamera();
      else await tracker.loadFile(file);
    });
  }

  const close = () => {
    release();
    if (dialog.open) dialog.close();
  };
  find('#capture-close').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  find('#capture-upload').onclick = () => input.click();
  find('#capture-camera').onclick = () => beginSource('camera');
  input.onchange = () => {
    const file = input.files[0];
    if (file && dialog.open) beginSource('file', file);
  };
  preview.addEventListener('resize', sizePreview);
  choose.onclick = showPicker;
  start.onclick = () => {
    if (!tracker || (phase !== 'ready' && phase !== 'error')) return;
    path = null;
    setPhase('tracking');
    const token = epoch;
    run(async () => {
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
      onGesture(points, name);
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
    close,
    dispose() {
      close();
      dialog.remove();
    },
  };
}
