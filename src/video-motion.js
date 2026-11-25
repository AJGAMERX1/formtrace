import { createDetector, createFlock, drawOverlay } from './flock-tracker.js';

const FILE_SAMPLE_RATE = 30;
const CAMERA_SAMPLE_RATE = 20;
const MAX_FILE_FRAMES = 1800;
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

export function createVideoTracker({ video, overlay, onProgress, onComplete, onStatus, onError }) {
  let controller = null, runController = null, fileURL = null, cameraStream = null, frame = null;
  let source = null, phase = 'idle', clipDuration = 0, elapsed = 0;
  let detector = null, flock = null, state = null, frozen = null;
  let overlayMode = 'trails', region = null, captureStarted = 0, lastReported = 0;
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
    region = null;
    state = null;
    flock = null;
    frozen = null;
    detector = null;
    drawOverlay(overlay, state, overlayMode, frozen);
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
    state = flock.snapshot();
    onProgress?.({ phase, source, fraction, elapsed, ...state,
      points: state.tracks[0]?.points.map(p => [p.x, p.y]) ?? [] });
    drawOverlay(overlay, state, overlayMode, frozen);
  }

  function sample(time) {
    elapsed = time;
    flock.update(detector(), time);
  }

  function finish() {
    if (phase !== 'tracking') return;
    endRun();
    const paths = flock.paths();
    if (!paths.length) {
      reportError(Error('Too little movement was detected. Try a longer gesture against a steady background.'));
      return;
    }
    state = flock.snapshot();
    const meta = { source, duration: elapsed, count: state.count, trackCount: state.trackCount,
      exportedTrackCount: paths.length, paths, heatmap: state.heatmap, region };
    if (source === 'camera') {
      if (video.readyState >= 2) {
        frozen = document.createElement('canvas');
        frozen.width = overlay.width;
        frozen.height = overlay.height;
        frozen.getContext('2d').drawImage(video, 0, 0, frozen.width, frozen.height);
      }
      releaseCamera();
    }
    drawOverlay(overlay, state, overlayMode, frozen);
    status('complete', 'Motion captured');
    onComplete?.(paths[0].points, meta);
  }

  function analyzeAt(time, fraction) {
    sample(time);
    if (fraction === 1 || performance.now()-lastReported >= 75) {
      lastReported = performance.now();
      progress(fraction);
    }
  }

  // Long GOPs can require decoding the same frames repeatedly when seeking.
  // Decode longer clips in order. A stalled decoder falls back to exact seeks
  // from the last analyzed timestamp and preserves the paths collected so far.
  function playFrames(signal, interval) {
    return new Promise((resolve, reject) => {
      let frameId, timer, last = elapsed, closed = false;
      const previousRate = video.playbackRate;
      function close(error) {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
        video.removeEventListener('ended', done);
        video.removeEventListener('error', failed);
        signal.removeEventListener('abort', abort);
        video.pause();
        video.playbackRate = previousRate;
        if (error) reject(error);
        else resolve(last);
      }
      function done() { close(); }
      function failed() { close(Error('The video could not be decoded. Try a different file.')); }
      function abort() { close(new DOMException('Cancelled', 'AbortError')); }
      function schedule() {
        clearTimeout(timer);
        timer = setTimeout(done, 2300);
        frameId = video.requestVideoFrameCallback((_, metadata) => {
          if (closed) return;
          try {
            const time = metadata.mediaTime;
            if (time-last >= interval*0.79) {
              analyzeAt(time, Math.min(1,time/clipDuration));
              last = time;
            }
            schedule();
          } catch (error) { close(error); }
        });
      }
      signal.addEventListener('abort', abort, {once:true});
      video.addEventListener('ended', done, {once:true});
      video.addEventListener('error', failed, {once:true});
      if (signal.aborted) { abort(); return; }
      video.playbackRate = video.videoWidth * video.videoHeight > 2_100_000 ? 1 : 1.5;
      schedule();
      video.play().catch(done);
    });
  }

  async function trackFile(signal) {
    const frames = clamp(Math.ceil(clipDuration*FILE_SAMPLE_RATE)+1, 3, MAX_FILE_FRAMES);
    const finalTime = Math.max(0, clipDuration-Math.min(0.02,clipDuration*0.02));
    const interval = finalTime/(frames-1);
    await seek(video,0,signal);
    if (signal.aborted) return;
    analyzeAt(0,0);
    let analyzed = 0;
    const expensiveSeeks = clipDuration > 8 || video.videoWidth * video.videoHeight > 2_100_000;
    if (expensiveSeeks && typeof video.requestVideoFrameCallback === 'function') {
      analyzed = await playFrames(signal, interval);
      if (signal.aborted) return;
    }
    const first = Math.max(1, Math.floor(analyzed/interval)+1);
    for (let i = first; i < frames; i++) {
      const time = i*interval;
      await seek(video,time,signal);
      if (signal.aborted) return;
      analyzeAt(time,i/(frames-1));
    }
    elapsed = clipDuration;
    progress(1);
    finish();
  }

  function trackCamera(signal) {
    let lastSample = -Infinity;
    let lastVideoTime = -1;
    function tick(now) {
      if (signal.aborted) return;
      try {
        if (now - lastSample >= 1000 / CAMERA_SAMPLE_RATE && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
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
    frozen = null;
    state = null;
    elapsed = 0;
    lastReported = 0;
    captureStarted = performance.now();
    drawOverlay(overlay, state, overlayMode, frozen);
    try {
      detector = createDetector(video, region);
      flock = createFlock(video.videoWidth / video.videoHeight, region);
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
    setRegion(bounds) {
      if (disposed || !['ready', 'error'].includes(phase)) return false;
      if (bounds === null) { region = null; return true; }
      if (!bounds || ![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite)) return false;
      const left = clamp(bounds.x,0,1), top = clamp(bounds.y,0,1);
      const right = clamp(bounds.x+bounds.width,0,1), bottom = clamp(bounds.y+bounds.height,0,1);
      if (right <= left || bottom <= top) return false;
      region = { x: left, y: top, width: right-left, height: bottom-top };
      return true;
    },
    setOverlayMode(mode) {
      if (disposed || !['trails','heatmap'].includes(mode)) return;
      overlayMode = mode;
      drawOverlay(overlay, state, overlayMode, frozen);
    },
    finishTracking() { if (source === 'camera') finish(); },
    stop() { if (!disposed) { clearSource(); status('idle', ''); } },
    dispose() { if (!disposed) { disposed = true; clearSource(); phase = 'idle'; } },
  };
}
