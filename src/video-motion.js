const SAMPLE_RATE = 12;
const MAX_FILE_FRAMES = 600;
const MAX_PATH_SAMPLES = 640;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function nextMediaEvent(video, eventName, signal) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener(eventName, success);
      video.removeEventListener('error', failure);
      signal.removeEventListener('abort', abort);
    }
    function success() { cleanup(); resolve(); }
    function failure() { cleanup(); reject(new Error('This video could not be decoded. Try a different MP4 or WebM file.')); }
    function abort() { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The video did not provide a frame. Try reopening the source.'));
    }, 14000);
    video.addEventListener(eventName, success, { once: true });
    video.addEventListener('error', failure, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function seek(video, time, signal) {
  if (Math.abs(video.currentTime - time) < 0.0001 && !video.seeking && video.readyState >= 2) return;
  const settled = nextMediaEvent(video, 'seeked', signal);
  video.currentTime = time;
  await settled;
}

function quantile(histogram, count, fraction) {
  let seen = 0;
  const target = Math.max(1, Math.ceil(count * fraction));
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i];
    if (seen >= target) return i;
  }
  return 0;
}

// A per-channel median removes whole-frame exposure or white balance changes.
// The remaining local motion is grouped into connected regions on a coarse grid.
function motionDetector(video) {
  const scale = 128 / Math.max(video.videoWidth, video.videoHeight);
  const w = Math.max(8, 2 * Math.round(video.videoWidth * scale / 2));
  const h = Math.max(8, 2 * Math.round(video.videoHeight * scale / 2));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cols = w / 2;
  const rows = h / 2;
  const length = w * h;
  const scores = new Uint8Array(length);
  const grid = new Float32Array(cols * rows);
  const queue = new Uint16Array(grid.length);
  let prior;
  let background;
  let last;

  return () => {
    ctx.drawImage(video, 0, 0, w, h);
    const current = ctx.getImageData(0, 0, w, h).data;
    if (!prior) {
      prior = current;
      background = new Float32Array(current);
      return null;
    }
    const offsets = [new Uint16Array(511), new Uint16Array(511), new Uint16Array(511)];
    let probes = 0;
    for (let i = 0; i < length; i += 5) {
      for (let c = 0; c < 3; c++) offsets[c][255 + current[4 * i + c] - prior[4 * i + c]]++;
      probes++;
    }
    const shifts = offsets.map(hist => quantile(hist, probes, 0.5) - 255);
    const changes = new Uint16Array(256);
    const [redShift, greenShift, blueShift] = shifts;
    for (let i = 0; i < length; i++) {
      const p = 4 * i;
      const difference = Math.max(
        Math.abs(current[p] - prior[p] - redShift),
        Math.abs(current[p + 1] - prior[p + 1] - greenShift),
        Math.abs(current[p + 2] - prior[p + 2] - blueShift),
      );
      scores[i] = Math.min(255, difference);
      changes[scores[i]]++;
    }
    const threshold = Math.max(13, quantile(changes, length, 0.60) * 2.6 + 6);
    let moving = 0;
    grid.fill(0);
    for (let i = 0; i < length; i++) {
      const p = i * 4;
      const changed = scores[i] >= threshold;
      let foreground = 0;
      for (let c = 0; c < 3; c++) {
        const bg = clamp(background[p + c] + shifts[c], 0, 255);
        const deviation = current[p + c] - bg;
        foreground = Math.max(foreground, Math.abs(deviation));
        background[p + c] = bg + deviation * (changed ? 0.012 : 0.10);
      }
      if (changed) {
        const cell = (Math.floor(i / w) >> 1) * cols + ((i % w) >> 1);
        grid[cell] += scores[i] * (0.20 + Math.min(1, foreground / 52));
        moving++;
      }
    }
    prior = current;
    if (moving < 5 || moving > 0.62 * length) return null;
    let best = null;
    let bestScore = 0;
    for (let seed = 0; seed < grid.length; seed++) {
      if (grid[seed] <= 0) continue;
      let head = 0, tail = 1;
      let mass = 0, sumX = 0, sumY = 0;
      queue[0] = seed;
      grid[seed] *= -1;
      while (head < tail) {
        const cell = queue[head++];
        const x = cell % cols, y = Math.floor(cell / cols);
        const weight = -grid[cell];
        mass += weight;
        sumX += (x + 0.5) * weight;
        sumY += (y + 0.5) * weight;
        for (let v = Math.max(0, y - 1); v <= Math.min(rows - 1, y + 1); v++) {
          for (let u = Math.max(0, x - 1); u <= Math.min(cols - 1, x + 1); u++) {
            const near = v * cols + u;
            if (grid[near] > 0) {
              grid[near] *= -1;
              queue[tail++] = near;
            }
          }
        }
      }
      if (tail < 3 || mass < threshold * 6) continue;
      const x = sumX / mass / cols;
      const y = sumY / mass / rows;
      const continuity = last ? 1 + 0.90 * Math.exp(-7 * Math.hypot(x - last.x, y - last.y)) : 1;
      const score = mass * continuity;
      if (score > bestScore) {
        best = { x, y, size: Math.sqrt(tail / grid.length) };
        bestScore = score;
      }
    }
    if (best) last = best;
    return best;
  };
}

function sculpturePath(samples, aspect) {
  if (samples.length < 3) return null;
  const first = samples[0];
  let travel = 0;
  let depth = 0;
  const ranges = ['x', 'y', 'size'].map(key => {
    const values = samples.map(p => p[key]);
    return Math.max(...values) - Math.min(...values);
  });
  if (Math.max(ranges[0], ranges[1]) < 0.045 && ranges[2] < 0.06) return null;
  const points = samples.map((p, i) => {
    const prev = samples[Math.max(0, i - 1)];
    const distance = Math.hypot((p.x - prev.x) * aspect, p.y - prev.y);
    travel += distance;
    const speed = distance / Math.max(0.04, p.t - prev.t);
    const target = 0.19 * Math.tanh(speed) + 0.80 * (p.size - first.size) + 0.13 * Math.sin(4 * travel);
    depth += 0.33 * (target - depth);
    return [p.x * aspect, -p.y, depth];
  });
  const min = [0, 1, 2].map(c => Math.min(...points.map(p => p[c])));
  const max = [0, 1, 2].map(c => Math.max(...points.map(p => p[c])));
  const span = max.map((v, c) => v - min[c]);
  const scale = 4.4 / Math.max(...span, 0.025);
  return points.map(p => p.map((v, c) => (v - min[c] - span[c] / 2) * scale));
}

function paintTrail(overlay, samples) {
  const ctx = overlay.getContext('2d');
  const w = overlay.width, h = overlay.height;
  ctx.clearRect(0, 0, w, h);
  if (!samples.length) return;
  const unit = Math.max(0.75, Math.min(w, h) / 350);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  samples.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x * w, p.y * h);
    else ctx.lineTo(p.x * w, p.y * h);
  });
  ctx.lineWidth = 4.8 * unit;
  ctx.strokeStyle = 'rgba(35,18,55,0.65)';
  ctx.stroke();
  ctx.lineWidth = 2.4 * unit;
  ctx.strokeStyle = '#d4afff';
  ctx.stroke();
  const tip = samples.at(-1);
  ctx.beginPath();
  ctx.arc(tip.x * w, tip.y * h, 6 * unit, 0, 2 * Math.PI);
  ctx.fillStyle = '#a26ae3';
  ctx.fill();
  ctx.lineWidth = 2 * unit;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

export function createVideoTracker({ video, overlay, onProgress, onComplete, onStatus, onError }) {
  let controller = null, runController = null, fileURL = null, cameraStream = null, frame = null;
  let source = null, phase = 'idle', clipDuration = 0, sampleCount = 0, elapsed = 0;
  let samples = [], detector = null, captureStarted = 0, lastReported = 0;
  let disposed = false;
  video.muted = true;
  video.playsInline = true;
  video.loop = false;

  function status(next, message) {
    phase = next;
    onStatus?.({ phase, source, message, duration: clipDuration });
  }

  function endRun() {
    runController?.abort();
    runController = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function releaseCamera() {
    for (const track of cameraStream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    cameraStream = null;
    video.srcObject = null;
  }

  function clearSource() {
    endRun();
    controller?.abort();
    controller = null;
    video.pause();
    releaseCamera();
    video.removeAttribute('src');
    video.load();
    if (fileURL) URL.revokeObjectURL(fileURL);
    fileURL = null;
    source = null;
    clipDuration = 0;
    samples = [];
    paintTrail(overlay, samples);
  }

  function reportError(err) {
    endRun();
    const error = err instanceof Error ? err : new Error(String(err));
    status('error', error.message);
    onError?.(error);
  }

  async function prepare(kind, file) {
    if (disposed) return false;
    clearSource();
    source = kind;
    controller = new AbortController();
    const signal = controller.signal;
    status('loading', kind === 'camera' ? 'Opening camera…' : 'Opening video…');
    try {
      if (kind === 'camera') {
        if (!navigator.mediaDevices?.getUserMedia) throw Error('Camera access requires a secure page and a supported browser.');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (signal.aborted) {
          stream.getTracks().forEach(track => track.stop());
          return false;
        }
        cameraStream = stream;
        video.srcObject = stream;
        await video.play();
        stream.getVideoTracks()[0].onended = () => {
          if (!signal.aborted) {
            releaseCamera();
            reportError(Error('The camera disconnected. Reopen the camera to continue.'));
          }
        };
      } else {
        if (!file?.size) throw Error('Choose a video file with recorded frames.');
        fileURL = URL.createObjectURL(file);
        video.src = fileURL;
        video.load();
      }
      if (video.readyState < 2) await nextMediaEvent(video, 'loadeddata', signal);
      if (signal.aborted) return false;
      if (!video.videoWidth || !video.videoHeight) throw Error('No video frames were found. Choose a video file.');
      if (kind === 'file') {
        if (!Number.isFinite(video.duration)) {
          // Some recorded WebM files omit duration. Seeking to the end makes
          // the demuxer locate the final frame before we sample the whole clip.
          await seek(video, 1e9, signal);
          clipDuration = Number.isFinite(video.duration) ? video.duration : video.currentTime;
          await seek(video, 0, signal);
        } else clipDuration = video.duration;
        if (!(clipDuration > 0) || clipDuration >= 1e9) throw Error('The video duration could not be read. Try a different video.');
      }
      if (signal.aborted) return false;
      const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
      overlay.width = Math.max(1, Math.round(video.videoWidth * scale));
      overlay.height = Math.max(1, Math.round(video.videoHeight * scale));
      status('ready', kind === 'camera' ? 'Camera ready' : 'Video ready');
      return true;
    } catch (err) {
      if (signal.aborted) return false;
      releaseCamera();
      const messages = {
        NotAllowedError: 'Camera access was declined. Allow camera access or upload a video.',
        NotFoundError: 'No camera was found. Connect a camera or upload a video.',
        NotReadableError: 'The camera is busy or unavailable. Close other camera apps and try again.',
      };
      reportError(kind === 'camera' && messages[err.name] ? Error(messages[err.name]) : err);
      return false;
    }
  }

  function progress(fraction) {
    onProgress?.({ phase, source, fraction, elapsed, count: sampleCount, points: samples.map(p => [p.x, p.y]) });
  }

  function sample(time) {
    elapsed = time;
    const found = detector();
    if (!found) return;
    const prev = samples.at(-1);
    const x = prev ? prev.x + (found.x - prev.x) * 0.66 : found.x;
    const y = prev ? prev.y + (found.y - prev.y) * 0.66 : found.y;
    const size = prev ? prev.size + (found.size - prev.size) * 0.35 : found.size;
    if (prev && Math.hypot(x - prev.x, y - prev.y) < 0.004 && Math.abs(size - prev.size) < 0.014) return;
    if (samples.length >= MAX_PATH_SAMPLES) samples = samples.filter((_, i) => i % 2 === 0);
    samples.push({ x, y, size, t: time });
    sampleCount++;
    paintTrail(overlay, samples);
  }

  function finish() {
    if (phase !== 'tracking') return;
    endRun();
    const path = sculpturePath(samples, video.videoWidth / video.videoHeight);
    if (!path) {
      reportError(Error('Too little movement was detected. Try a longer gesture against a steady background.'));
      return;
    }
    const meta = { source, duration: elapsed, count: sampleCount };
    if (source === 'camera') {
      const ctx = overlay.getContext('2d');
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      if (video.readyState >= 2) ctx.drawImage(video, 0, 0, overlay.width, overlay.height);
      ctx.restore();
      releaseCamera();
    }
    status('complete', 'Motion captured');
    onComplete?.(path, meta);
  }

  async function trackFile(signal) {
    const frames = clamp(Math.ceil(clipDuration * SAMPLE_RATE) + 1, 3, MAX_FILE_FRAMES);
    const finalTime = Math.max(0, clipDuration - Math.min(0.02, clipDuration * 0.02));
    for (let i = 0; i < frames; i++) {
      const fraction = i / (frames - 1);
      await seek(video, fraction * finalTime, signal);
      if (signal.aborted) return;
      sample(fraction * finalTime);
      if (i === frames - 1 || performance.now() - lastReported >= 75) {
        lastReported = performance.now();
        progress(fraction);
      }
    }
    elapsed = clipDuration;
    finish();
  }

  function trackCamera(signal) {
    let lastSample = -Infinity;
    let lastVideoTime = -1;
    function tick(now) {
      if (signal.aborted) return;
      try {
        if (now - lastSample >= 1000 / SAMPLE_RATE && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastSample = now;
          lastVideoTime = video.currentTime;
          sample((now - captureStarted) / 1000);
          progress(null);
        }
        if (!signal.aborted) frame = requestAnimationFrame(tick);
      } catch (err) { reportError(err); }
    }
    frame = requestAnimationFrame(tick);
  }

  async function startTracking() {
    if (disposed || !['ready', 'complete', 'error'].includes(phase)) return false;
    if (!source || (source === 'file' ? !clipDuration : !cameraStream)) return false;
    endRun();
    runController = new AbortController();
    const signal = runController.signal;
    samples = [];
    sampleCount = 0;
    elapsed = 0;
    lastReported = 0;
    captureStarted = performance.now();
    paintTrail(overlay, samples);
    try {
      detector = motionDetector(video);
      status('tracking', source === 'file' ? 'Tracking video…' : 'Tracking camera…');
      progress(source === 'file' ? 0 : null);
      if (source === 'file') await trackFile(signal);
      else trackCamera(signal);
      return true;
    } catch (err) {
      if (!signal.aborted) reportError(err);
      return false;
    }
  }

  return {
    loadFile: file => prepare('file', file),
    startCamera: () => prepare('camera'),
    startTracking,
    finishTracking() { if (source === 'camera') finish(); },
    stop() { if (!disposed) { clearSource(); status('idle', ''); } },
    dispose() { if (!disposed) { disposed = true; clearSource(); phase = 'idle'; } },
  };
}
