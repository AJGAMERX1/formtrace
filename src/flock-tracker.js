import { makePassScale } from './pass-colors.js';

// Measurements stay in normalized image coordinates until every flight path
// can be framed together. Depth is inferred from speed and apparent size.
const MAX_ACTIVE = 160;
const MAX_EXPORTED = 48;
const MAX_POINTS = 480;
const TRAIL_COLORS = ['#d4afff', '#7de2c2', '#ffbb83', '#88d1fa', '#ff99ab', '#f0e38c'];
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));

function quantile(hist, count, fraction) {
  let seen = 0;
  const limit = Math.max(1, Math.ceil(count * fraction));
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i];
    if (seen >= limit) return i;
  }
  return 0;
}

export function createDetector(video, region = null) {
  const crop = region ?? { x: 0, y: 0, width: 1, height: 1 };
  const sourceX = crop.x * video.videoWidth, sourceY = crop.y * video.videoHeight;
  const sourceWidth = crop.width * video.videoWidth, sourceHeight = crop.height * video.videoHeight;
  const scale = Math.min(1, 640 / Math.max(sourceWidth, sourceHeight));
  const w = Math.max(8, 2 * Math.round(sourceWidth * scale / 2));
  const h = Math.max(8, 2 * Math.round(sourceHeight * scale / 2));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const length = w * h, cols = w / 2, rows = h / 2;
  const motion = new Uint8Array(length);
  const luma = new Uint8Array(length);
  const contrast = new Uint8Array(length);
  const localEnergy = new Uint8Array(length);
  const weights = new Float32Array(cols * rows);
  const evidence = new Float32Array(weights.length);
  const detail = new Uint8Array(weights.length);
  const queue = new Uint32Array(weights.length);
  const shifts = [new Uint32Array(511), new Uint32Array(511), new Uint32Array(511)];
  const changes = new Uint32Array(256);
  const stride = w + 1;
  const integral = new Uint32Array((w + 1) * (h + 1));
  const smoothRadius = Math.max(4, Math.round(Math.min(w,h) / 32));
  const firstColumn = Array.from({length:w}, (_, x) => Math.max(0,x-smoothRadius));
  const lastColumn = Array.from({length:w}, (_, x) => Math.min(w,x+smoothRadius+1));
  let previous, background;

  return () => {
    ctx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    // The local mean tracks broad lighting changes (including rolling bands
    // from artificial lighting). A bird crossing the region remains distinct.
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        const i = y*w+x, p = 4*i;
        luma[i] = (pixels[p] + 2*pixels[p+1] + pixels[p+2]) >> 2;
        rowSum += luma[i];
        integral[(y+1)*stride+x+1] = integral[y*stride+x+1] + rowSum;
      }
    }
    for (let y = 0; y < h; y++) {
      const top = Math.max(0,y-smoothRadius), bottom = Math.min(h,y+smoothRadius+1);
      const lo = top*stride, hi = bottom*stride;
      for (let x = 0; x < w; x++) {
        const i = y*w+x, p = 4*i, left = firstColumn[x], right = lastColumn[x];
        const mean = (integral[hi+right]-integral[hi+left]-integral[lo+right]+integral[lo+left]) /
          ((right-left)*(bottom-top));
        const offset = 128-mean;
        pixels[p] += offset; pixels[p+1] += offset; pixels[p+2] += offset;
      }
    }
    if (!previous) {
      previous = pixels;
      background = new Float32Array(pixels);
      return { regions: [], cut: false };
    }
    // Offset the whole image by its median color change before looking for
    // local movement. This suppresses exposure shifts and camera white balance.
    for (const channel of shifts) channel.fill(0);
    let probes = 0;
    for (let i = 0; i < length; i += 15) {
      const p = i * 4;
      for (let c = 0; c < 3; c++) shifts[c][255 + pixels[p+c] - previous[p+c]]++;
      probes++;
    }
    const [dr, dg, db] = shifts.map(hist => quantile(hist, probes, 0.50) - 255);
    changes.fill(0);
    for (let i = 0; i < length; i++) {
      const p = i * 4;
      const diff = Math.max(
        Math.abs(pixels[p] - previous[p] - dr),
        Math.abs(pixels[p+1] - previous[p+1] - dg),
        Math.abs(pixels[p+2] - previous[p+2] - db),
      );
      motion[i] = Math.min(255, diff);
      changes[motion[i]]++;
      luma[i] = (pixels[p] + 2 * pixels[p+1] + pixels[p+2]) >> 2;
    }
    const noise = quantile(changes, length, 0.60);
    const threshold = Math.max(9, noise * 2.9 + 7);
    if (noise > 34) {
      previous = pixels;
      background.set(pixels);
      return { regions: [], cut: true };
    }
    // Additional contrast against neighboring pixels separates small distant
    // silhouettes from the newly revealed sky behind their previous position.
    const radius = Math.min(4, (Math.min(w, h) - 1) >> 1);
    contrast.fill(0);
    localEnergy.fill(0);
    for (let y = radius; y < h - radius; y++) {
      for (let x = radius; x < w - radius; x++) {
        const i = y * w + x;
        const surround = (luma[i-radius] + luma[i+radius] + luma[i-w*radius] + luma[i+w*radius]) * 0.25;
        contrast[i] = Math.abs(luma[i] - surround);
        if (motion[i] < threshold && contrast[i] < threshold) continue;
        const reach = Math.min(8, x, y, w-1-x, h-1-y);
        let energy = 0;
        for (let c = 0; c < 3; c++) {
          const p = i*4+c, left = p-4*reach, right = p+4*reach;
          const top = p-4*reach*w, bottom = p+4*reach*w;
          const neighbors = (pixels[left]-background[left] + pixels[right]-background[right]
            + pixels[top]-background[top] + pixels[bottom]-background[bottom]) * 0.25;
          energy = Math.max(energy, Math.abs(pixels[p]-background[p]-neighbors));
        }
        localEnergy[i] = Math.min(255, energy);
      }
    }
    weights.fill(0);
    evidence.fill(0);
    detail.fill(0);
    for (let i = 0; i < length; i++) {
      const p = i * 4;
      const br = clamp(background[p] + dr, 0, 255);
      const bg = clamp(background[p+1] + dg, 0, 255);
      const bb = clamp(background[p+2] + db, 0, 255);
      const rr = pixels[p] - br, rg = pixels[p+1] - bg, rb = pixels[p+2] - bb;
      const fg = Math.max(Math.abs(rr), Math.abs(rg), Math.abs(rb));
      const rate = fg > threshold ? 0.055 : 0.23;
      background[p] = br + rr * rate;
      background[p+1] = bg + rg * rate;
      background[p+2] = bb + rb * rate;
      if (fg < threshold || localEnergy[i] < Math.max(14, threshold)) continue;
      const cell = (Math.floor(i / w) >> 1) * cols + ((i % w) >> 1);
      weights[cell] += Math.min(180, fg) * (0.35 + Math.min(1.6, contrast[i] / 30));
      evidence[cell] += motion[i] >= threshold ? Math.min(200, motion[i]) : 0;
      detail[cell] = Math.max(detail[cell], contrast[i]);
    }
    previous = pixels;
    const regions = [];
    for (let seed = 0; seed < weights.length; seed++) {
      if (weights[seed] <= 0) continue;
      let head = 0, tail = 1, mass = 0, sumX = 0, sumY = 0, activity = 0, peak = 0;
      let left = cols, right = 0, top = rows, bottom = 0;
      queue[0] = seed;
      weights[seed] *= -1;
      while (head < tail) {
        const cell = queue[head++];
        const x = cell % cols, y = Math.floor(cell / cols), wt = -weights[cell];
        sumX += (x + 0.5) * wt;
        sumY += (y + 0.5) * wt;
        mass += wt;
        activity += evidence[cell];
        peak = Math.max(peak, detail[cell]);
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (let v = Math.max(0, y-1); v <= Math.min(rows-1, y+1); v++) {
          for (let u = Math.max(0, x-1); u <= Math.min(cols-1, x+1); u++) {
            const next = v * cols + u;
            if ((u !== x && v !== y) || weights[next] <= 0) continue;
            weights[next] *= -1;
            queue[tail++] = next;
          }
        }
      }
      if (mass < 18 || activity < threshold * 1.35 || peak < 5 || tail > weights.length * 0.37) continue;
      const x = sumX / mass / cols, y = sumY / mass / rows;
      const center = Math.min(h-1, Math.floor(y*h)) * w + Math.min(w-1, Math.floor(x*w));
      regions.push({ x, y, size: Math.sqrt(tail / weights.length), light: luma[center], mass,
        left: left / cols, right: (right+1) / cols, top: top / rows, bottom: (bottom+1) / rows });
    }
    regions.sort((a, b) => b.mass - a.mass);
    // Wing or rim fragments inside the outline of a larger foreground region
    // describe that same subject. Keep geometrically separate neighbors.
    const accepted = [];
    for (const r of regions) {
      const contained = accepted.some(a => a.mass > r.mass * 3 && r.x >= a.left && r.x <= a.right && r.y >= a.top && r.y <= a.bottom);
      if (!contained) accepted.push(r);
      if (accepted.length >= MAX_ACTIVE + 32) break;
    }
    if (region) {
      const sizeScale = Math.sqrt(crop.width * crop.height);
      for (const r of accepted) {
        r.x = crop.x + r.x * crop.width;
        r.y = crop.y + r.y * crop.height;
        r.left = crop.x + r.left * crop.width;
        r.right = crop.x + r.right * crop.width;
        r.top = crop.y + r.top * crop.height;
        r.bottom = crop.y + r.bottom * crop.height;
        r.size *= sizeScale;
      }
    }
    return { regions: accepted, cut: false };
  };
}

function makeHeatmap(aspect, region) {
  const columns = aspect >= 1 ? 32 : Math.max(4, Math.round(32 * aspect));
  const rows = aspect <= 1 ? 32 : Math.max(4, Math.round(32 / aspect));
  return { columns, rows, counts: Array(columns * rows).fill(0), maxPasses: 0, aspectRatio: aspect, region };
}

function addPassSegment(track, from, to, map) {
  const { columns, rows, counts } = map;
  const dx = (to.x - from.x) * columns, dy = (to.y - from.y) * rows;
  const steps = Math.max(1, Math.ceil(3 * Math.max(Math.abs(dx), Math.abs(dy))));
  for (let n = 1; n <= steps; n++) {
    const x = clamp(from.x * columns + dx*n/steps, 0, columns - 1e-7);
    const y = clamp(from.y * rows + dy*n/steps, 0, rows - 1e-7);
    // A full departure beyond a tolerance band rearms a cell. Hovering and
    // position jitter at a border therefore do not create repeated passes.
    for (const cell of track.inside) {
      const cx = cell % columns, cy = Math.floor(cell / columns);
      if (x < cx-0.34 || x > cx+1.34 || y < cy-0.34 || y > cy+1.34) track.inside.delete(cell);
    }
    const cell = Math.floor(y) * columns + Math.floor(x);
    if (track.inside.has(cell)) continue;
    track.inside.add(cell);
    map.maxPasses = Math.max(map.maxPasses, ++counts[cell]);
  }
}

function record(track, r, time, map) {
  const prev = track.points.at(-1);
  const dt = Math.max(0.015, time - track.t);
  if (track.hits) {
    const velocityWeight = track.missing ? 0.34 : 0.55;
    track.vx += velocityWeight * (clamp((r.x - track.x) / dt, -3, 3) - track.vx);
    track.vy += velocityWeight * (clamp((r.y - track.y) / dt, -3, 3) - track.vy);
  }
  Object.assign(track, { x: r.x, y: r.y, size: r.size, light: r.light, t: time, missing: 0 });
  track.hits++;
  const p = {
    x: prev ? prev.x + (r.x - prev.x) * 0.91 : r.x,
    y: prev ? prev.y + (r.y - prev.y) * 0.91 : r.y,
    size: prev ? prev.size + (r.size - prev.size) * 0.45 : r.size,
    t: time,
  };
  const displacement = prev ? Math.hypot(p.x-prev.x, p.y-prev.y) : 0;
  if (prev && displacement < 0.0011 && Math.abs(p.size-prev.size) < 0.005) return false;
  track.travel += displacement;
  track.minX = Math.min(track.minX, p.x); track.maxX = Math.max(track.maxX, p.x);
  track.minY = Math.min(track.minY, p.y); track.maxY = Math.max(track.maxY, p.y);
  track.minSize = Math.min(track.minSize, p.size); track.maxSize = Math.max(track.maxSize, p.size);
  if (track.points.length >= MAX_POINTS) track.points = track.points.filter((_, i) => i % 2 === 0);
  track.points.push(p);
  track.span = Math.hypot(track.maxX-track.minX, track.maxY-track.minY);
  if (track.confirmed) {
    addPassSegment(track, prev ?? p, p, map);
    return false;
  }
  if (track.hits < 5 || track.points.length < 4 || time-track.points[0].t < 0.13) return false;
  const coherent = track.span > 0.013 && track.span / Math.max(0.001, track.travel) > 0.28;
  if (!coherent && track.maxSize - track.minSize < 0.060) return false;
  track.confirmed = true;
  track.points.forEach((pt, i, pts) => addPassSegment(track, i ? pts[i-1] : pt, pt, map));
  return true;
}

function score(t) { return t.hits * (0.05 + t.span); }

function sharedPaths(tracks, aspect) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const paths = tracks.map(track => {
    let travel = 0, depth = 0;
    const points = track.points.map((p, i, pts) => {
      const prev = pts[Math.max(0, i-1)];
      const step = Math.hypot((p.x-prev.x)*aspect, p.y-prev.y);
      travel += step;
      const speed = step / Math.max(0.035, p.t-prev.t);
      const target = 0.16 * Math.tanh(speed) + 0.80 * p.size + 0.11 * Math.sin(4*travel);
      depth = i ? depth + 0.4 * (target - depth) : target;
      const pt = [p.x * aspect, -p.y, depth];
      for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], pt[c]); max[c] = Math.max(max[c], pt[c]); }
      return pt;
    });
    return { id: track.id, points };
  });
  const span = max.map((v,c) => v - min[c]);
  const scale = 4.4 / Math.max(...span, 0.025);
  for (const path of paths) {
    for (const p of path.points) for (let c = 0; c < 3; c++) p[c] = (p[c]-min[c]-span[c]/2)*scale;
  }
  return paths;
}

export function createFlock(aspect, region = null) {
  let active = [], archived = [], nextId = 1, trackCount = 0, count = 0;
  const heatmap = makeHeatmap(aspect, region);

  function retire(track) {
    if (!track.confirmed) return;
    track.active = false;
    track.inside.clear();
    archived.push(track);
  }
  function confirmed() {
    return [...active.filter(t => t.confirmed), ...archived];
  }

  return {
    update({ regions, cut }, time) {
      if (cut) { active.forEach(retire); active = []; }
      const pairs = [];
      for (let i = 0; i < active.length; i++) {
        const t = active[i];
        const dt = Math.max(0.015, time - t.t);
        const speed = Math.hypot(t.vx, t.vy);
        const px = t.x + t.vx*dt, py = t.y + t.vy*dt;
        const gate = clamp(0.010 + 1.25*t.size + dt*(0.16 + Math.min(0.65, speed*0.64)), 0.018, 0.225);
        for (let j = 0; j < regions.length; j++) {
          const r = regions[j];
          const predicted = Math.hypot(r.x-px, r.y-py);
          if (predicted > gate) continue;
          const sizeDifference = Math.abs(Math.log((r.size+0.002)/(t.size+0.002)));
          if (sizeDifference > 1.5) continue;
          const position = Math.hypot(r.x-t.x, r.y-t.y);
          const cost = predicted + 0.12*position + 0.014*sizeDifference + Math.abs(r.light-t.light)/255*0.007;
          pairs.push({ i, j, cost });
        }
      }
      pairs.sort((a,b) => a.cost-b.cost);
      const usedTracks = new Set(), usedRegions = new Set();
      function ingest(track, region) {
        const priorLength = track.points.length;
        const previousPoint = track.points.at(-1);
        const newlyConfirmed = record(track, region, time, heatmap);
        if (newlyConfirmed) { trackCount++; count += track.points.length; }
        else if (track.confirmed && track.points.at(-1) !== previousPoint && priorLength) count++;
      }
      for (const {i, j} of pairs) {
        if (usedTracks.has(i) || usedRegions.has(j)) continue;
        usedTracks.add(i); usedRegions.add(j);
        ingest(active[i], regions[j]);
      }
      active = active.filter((track, i) => {
        if (usedTracks.has(i)) return true;
        track.missing++;
        if (track.missing <= (track.confirmed ? 4 : 2)) return true;
        retire(track);
        return false;
      });
      if (archived.length > MAX_EXPORTED) archived = archived.sort((a,b) => score(b)-score(a)).slice(0,MAX_EXPORTED);
      for (let j = 0; j < regions.length && active.length < MAX_ACTIVE; j++) {
        if (usedRegions.has(j)) continue;
        const t = { id: nextId++, active: true, confirmed: false, hits: 0, missing: 0, vx: 0, vy: 0, t: time,
          points: [], inside: new Set(), travel: 0, span: 0, minX: 1, maxX: 0, minY: 1, maxY: 0, minSize: 1, maxSize: 0 };
        ingest(t, regions[j]);
        active.push(t);
      }
    },
    snapshot() {
      const tracks = confirmed().sort((a,b) => score(b)-score(a)).map(t => ({ id:t.id, active:t.active && !t.missing, points:t.points }));
      return { count, trackCount, tracks, heatmap };
    },
    paths() { return sharedPaths(confirmed().sort((a,b) => score(b)-score(a)).slice(0,MAX_EXPORTED), aspect); },
  };
}

export function drawOverlay(canvas, state, mode, frozen) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  if (frozen) ctx.drawImage(frozen,0,0,w,h);
  if (!state) return;
  if (mode === 'heatmap') {
    const { columns,rows,counts,maxPasses } = state.heatmap;
    const scale = makePassScale(maxPasses);
    const cellWidth = w/columns, cellHeight = h/rows;
    ctx.save();
    const region = state.heatmap.region;
    if (region) {
      ctx.beginPath();
      ctx.rect(region.x*w,region.y*h,region.width*w,region.height*h);
      ctx.clip();
    }
    ctx.globalAlpha = 0.72;
    for (let i = 0; i < counts.length; i++) {
      if (!counts[i]) continue;
      ctx.fillStyle = scale.color(counts[i]);
      ctx.fillRect((i%columns)*cellWidth,Math.floor(i/columns)*cellHeight,cellWidth,cellHeight);
    }
    ctx.restore();
    return;
  }
  const unit = Math.max(0.7,Math.min(w,h)/370);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const track of state.tracks) {
    const color = TRAIL_COLORS[(track.id-1)%TRAIL_COLORS.length];
    ctx.beginPath();
    track.points.forEach((p,i) => {
      if (i) ctx.lineTo(p.x*w,p.y*h);
      else ctx.moveTo(p.x*w,p.y*h);
    });
    ctx.strokeStyle = 'rgba(29,16,49,0.68)';
    ctx.lineWidth = 3.5*unit; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 1.8*unit; ctx.stroke();
    if (track.active) {
      const p = track.points.at(-1);
      ctx.beginPath(); ctx.arc(p.x*w,p.y*h,(state.tracks.length > 6 ? 2.2 : 4.2)*unit,0,2*Math.PI);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.1*unit; ctx.stroke();
    }
  }
}
