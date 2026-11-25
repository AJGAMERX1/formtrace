import './export-panel.css';

export function setupExportPanel({ onExport }) {
  const main = document.querySelector('#export');
  const split = document.createElement('div');
  split.className = 'export-split';
  split.innerHTML = `
    <button type="button" id="export-options" title="Choose export format" aria-label="Choose export format"
      aria-haspopup="menu" aria-expanded="false" aria-controls="export-menu">
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg>
    </button>
    <div class="export-menu" id="export-menu" role="menu" aria-label="Export format" hidden>
      <button id="export-glb" type="button" role="menuitem" data-format="glb" tabindex="-1"
        aria-labelledby="glb-title" aria-describedby="glb-detail">
        <span class="export-format-heading"><strong id="glb-title">Download GLB</strong><small>.glb</small></span>
        <span class="export-format-detail" id="glb-detail">Preserves geometry, colors, and materials.</span>
      </button>
      <button id="export-step" type="button" role="menuitem" data-format="step" tabindex="-1"
        aria-labelledby="step-title" aria-describedby="step-detail">
        <span class="export-format-heading"><strong id="step-title">Download STEP</strong><small>.step</small></span>
        <span class="export-format-detail" id="step-detail">Faceted geometry for CAD. 1 studio unit = 1 mm.</span>
      </button>
    </div>`;
  main.before(split);
  split.prepend(main);

  const trigger = split.querySelector('#export-options');
  const menu = split.querySelector('#export-menu');
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const events = new AbortController();
  const options = { signal: events.signal };

  function open(index = 0) {
    if (main.disabled) return;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    items[index].focus({ preventScroll: true });
  }

  function close(returnFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus && !trigger.disabled) trigger.focus({ preventScroll: true });
  }

  trigger.addEventListener('click', () => menu.hidden ? open() : close(), options);
  trigger.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open(event.key === 'ArrowUp' ? items.length - 1 : 0);
  }, options);
  menu.addEventListener('keydown', event => {
    const index = items.indexOf(document.activeElement);
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      case 'Tab':
        close(true);
        return;
      case 'Home': case 'End': case 'ArrowUp': case 'ArrowDown': {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items[next].focus();
        break;
      }
    }
  }, options);
  for (const item of items) {
    item.addEventListener('click', () => {
      if (main.disabled) { close(); return; }
      close(true);
      onExport(item.dataset.format);
    }, options);
  }

  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && event.target !== trigger && !trigger.contains(event.target) && !menu.contains(event.target)) close();
  }, options);
  split.addEventListener('focusout', event => {
    if (!split.contains(event.relatedTarget)) close();
  }, options);

  function matchMainButton() {
    trigger.disabled = main.disabled;
    if (main.disabled) close();
  }
  const observer = new MutationObserver(matchMainButton);
  observer.observe(main, { attributes: true, attributeFilter: ['disabled'] });
  matchMainButton();

  return {
    open,
    dispose() {
      observer.disconnect();
      events.abort();
      split.before(main);
      split.remove();
    },
  };
}
