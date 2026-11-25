const shapes = {
  video: '<rect x="2.5" y="5.5" width="12.5" height="13" rx="2"/><path d="m15 9.6 5-3a.8.8 0 0 1 1.3.7v9.4a.8.8 0 0 1-1.3.7l-5-3"/>',
  book: '<path d="M12 6c-2.3-1.8-5.7-2.1-9-1v13c3.3-1.1 6.7-.8 9 1 2.3-1.8 5.7-2.1 9-1V5c-3.3-1.1-6.7-.8-9 1Zm0 0v13"/>',
  download: '<path d="M12 3v11m-4-4 4 4 4-4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  undo: '<path d="m9 5-5 5 5 5M5 10h8a6 6 0 0 1 6 6v2"/>',
  redo: '<path d="m15 5 5 5-5 5m4-5h-8a6 6 0 0 0-6 6v2"/>',
  cube: '<path d="m12 2.8 8.6 4.8v9.1L12 21.3l-8.6-4.6V7.6L12 2.8Zm0 9.5 8.5-4.6M12 12.3 3.5 7.7m8.5 4.6v8.6"/>',
  pencil: '<path d="m4 16-.8 4.8 4.9-.9L20 8.1a1.8 1.8 0 0 0 0-2.6l-1.6-1.6a1.8 1.8 0 0 0-2.6 0L4 16Zm9.7-10 4.2 4.2"/>',
  orbit: '<ellipse cx="12" cy="12" rx="10" ry="5.3" transform="rotate(-32 12 12)"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M6 5A8 8 0 0 1 19.2 12M5.2 13a8 8 0 0 0 12.7 6"/>',
  fit: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14m-7-7v14"/>',
  mouse: '<rect x="6" y="2.8" width="12" height="18.4" rx="6"/><path d="M12 6v4"/>',
  sliders: '<path d="M3 7h6m4 0h8M3 17h11m4 0h3"/><circle cx="11" cy="7" r="2.2"/><circle cx="16" cy="17" r="2.2"/>',
  reset: '<path d="M4 4v5.5h5.5M4.9 9a7.7 7.7 0 1 1-.2 6"/>',
  ribbon: '<path d="M2 15c4 0 6-10 10-10 3.5 0 3.8 4.2 7.5 4.2H22L18.6 15c-4.7.8-6.3-4.7-9.5-4.1M2 15c2.5 4.2 5.9 3.8 9.1-.5l1.8-2.3"/>',
  tube: '<path d="M3.2 13.2c4 0 4.8-8.7 9.9-8.7 4.6 0 4.9 8.2 8.2 8.2m-18.1 5c6 0 6.5-9 9.9-9 2.8 0 3.7 8.1 8.2 8.1"/><ellipse cx="3.2" cy="15.5" rx="1.5" ry="2.3"/><path d="M21.3 12.7c1.8 0 1.7 4.1 0 4.1"/>',
  beads: '<circle cx="4" cy="15.5" r="2.6"/><circle cx="10.3" cy="11" r="3"/><circle cx="17.7" cy="8" r="3.5"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
  check: '<path d="m5 12 4.3 4.3L19 6.7"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
};

export function icon(name) {
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + shapes[name] + '</svg>';
}

export function mountIcons() {
  for (const slot of document.querySelectorAll('[data-icon]')) {
    slot.innerHTML = icon(slot.dataset.icon);
    slot.setAttribute('aria-hidden', 'true');
  }
}
