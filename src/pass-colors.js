const ANCHORS = ['#60badd', '#73d2ad', '#f2bb62', '#ec6d79'];
const channels = ANCHORS.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));

export function makePassScale(peak) {
  const end = Math.max(4, Number.isFinite(peak) ? Math.round(peak) : 0);
  // Geometric spacing keeps differences in lightly traveled cells visible
  // while reserving the hottest color for the highest recorded count.
  const mint = Math.max(2, Math.round(Math.cbrt(end)));
  const amber = Math.max(mint + 1, Math.round(end ** (2 / 3)));
  const counts = [1, mint, amber, end];
  const stops = counts.map((count, index) => ({ count, color: ANCHORS[index] }));
  const cache = new Map(stops.map(stop => [stop.count, stop.color]));

  function color(count) {
    if (!(count > 0) || !Number.isFinite(count)) return 'transparent';
    const value = Math.max(1, Math.min(end, count));
    if (cache.has(value)) return cache.get(value);
    const right = counts.findIndex(stop => stop > value);
    const left = right - 1;
    const fraction = (value - counts[left]) / (counts[right] - counts[left]);
    const rgb = channels[left].map((from, axis) => Math.round(from + (channels[right][axis] - from) * fraction));
    const hex = '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join('');
    cache.set(value, hex);
    return hex;
  }

  return { stops, color };
}
