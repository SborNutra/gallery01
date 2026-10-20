const grid = document.querySelector('.masonry-grid');
const filtersContainer = document.querySelector('.filters');
const sortToggleButton = document.querySelector('.sort-toggle');
const hueSlider = document.querySelector('#hue-slider');
const hueToggleButton = document.querySelector('.hue-toggle');
const hueFilterPanel = document.querySelector('.hue-filter');
const isMobileViewport = () => window.matchMedia('(max-width: 700px)').matches;

// Works live in data/shards.json (edited in Pages CMS); colours for the hue filter are
// computed by the Color Index workflow into data/image-index.csv.
const SHARDS_URL = 'data/shards.json';
const COLOR_INDEX_URL = 'data/image-index.csv';
const HUE_TOLERANCE = 18;

let items = [];
let batchSize = 20;
let currentIndex = 0;
let currentFilter = 'all';
let currentHue = null;
let sortDirection = 'desc';
let visibleItems = [];
let masonryColumns = [];
let nextColumnIndex = 0;
let wasMobileViewport = isMobileViewport();

const cardCache = new Map();

function normalizeImageKey(imageRef) {
  if (!imageRef) return '';

  const trimmed = imageRef.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
    return normalizedPath.toLowerCase();
  } catch {
    return decodeURIComponent(trimmed).replace(/^\/+/, '').toLowerCase();
  }
}

function fileNameFromImageRef(imageRef) {
  const normalized = normalizeImageKey(imageRef);
  if (!normalized) return '';
  const parts = normalized.split('/');
  return parts[parts.length - 1] || '';
}

function setRandomRainbowPhase(element) {
  if (!element) return;

  const randomStart = `${(Math.random() * 200).toFixed(2)}%`;
  const randomDelay = `${(-Math.random() * 4).toFixed(2)}s`;

  element.style.setProperty('--rainbow-start', randomStart);
  element.style.setProperty('--rainbow-delay', randomDelay);
}

function applyRandomRainbowStart() {
  const rainbowElements = document.querySelectorAll('.rainbow-hover');
  rainbowElements.forEach(setRandomRainbowPhase);
}

function setupRandomRainbowHover() {
  document.addEventListener('mouseenter', (event) => {
    const hoverTarget = event.target.closest && event.target.closest('.filters button, .card-tags span');
    if (!hoverTarget) return;

    setRandomRainbowPhase(hoverTarget);
  }, true);
}

applyRandomRainbowStart();
setupRandomRainbowHover();

// --------------------
// OVERLAY: one work at a time, with its own link (index.html#Beam1)
// --------------------
const overlay = document.getElementById('overlay');
const overlayContent = overlay ? overlay.querySelector('.overlay-content') : null;
let overlayItem = null;
let overlayPushedHistory = false;

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function formatDate(value) {
  if (!value) return '';
  // ISO dates from the CMS ("2026-10-12") are shown the old way ("Oct 12, 2026")
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (iso) return DATE_FORMAT.format(new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], 12)));
  return String(value);
}

function itemSlug(item) {
  return encodeURIComponent(item.id || fileNameFromImageRef(item.image));
}

function findItemBySlug(slug) {
  const wanted = decodeURIComponent(slug || '').toLowerCase();
  if (!wanted) return null;
  return items.find(item => (item.id || '').toLowerCase() === wanted)
    || items.find(item => fileNameFromImageRef(item.image) === wanted)
    || null;
}

function overlayList() {
  return overlayItem && visibleItems.includes(overlayItem) ? visibleItems : items;
}

function setHash(item, mode) {
  const url = item ? `#${itemSlug(item)}` : `${location.pathname}${location.search}`;
  if (mode === 'push') {
    history.pushState({ shard: true }, '', url);
    overlayPushedHistory = true;
  } else {
    history.replaceState(history.state, '', url);
  }
}

function buildOverlayMedia(item) {
  const url = item.image;
  if (getMediaType(url) === 'video') {
    const video = document.createElement('video');
    Object.assign(video, { src: url, autoplay: true, muted: true, loop: true, playsInline: true });
    const playing = video.play();
    if (playing) playing.catch(() => {});
    return video;
  }
  // start from the light preview (already cached), swap to the original once it has loaded
  const img = document.createElement('img');
  const thumb = getThumbUrl(url);
  img.src = thumb || url;
  img.alt = item.caption || item.id || '';
  if (thumb) {
    img.addEventListener('error', () => { if (img.src !== url) img.src = url; }, { once: true });
    const full = new Image();
    full.onload = () => { if (img.isConnected) img.src = url; };
    full.src = url;
  }
  return img;
}

function renderOverlay(item) {
  overlayItem = item;
  const list = overlayList();
  const position = list.indexOf(item);

  overlayContent.innerHTML = '';

  const stage = document.createElement('div');
  stage.className = 'overlay-stage';
  stage.appendChild(buildOverlayMedia(item));
  overlayContent.appendChild(stage);

  const bar = document.createElement('div');
  bar.className = 'overlay-bar';

  const info = document.createElement('div');
  info.className = 'overlay-info';
  const line = [formatDate(item.date), item.tags.join(', ')].filter(Boolean).join('  ·  ');
  if (line) {
    const meta = document.createElement('span');
    meta.className = 'overlay-meta';
    meta.textContent = line;
    info.appendChild(meta);
  }
  if (item.caption) {
    const caption = document.createElement('span');
    caption.className = 'overlay-caption';
    caption.textContent = item.caption;
    info.appendChild(caption);
  }
  bar.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  if (item.project_url) {
    const link = document.createElement('a');
    link.href = item.project_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'overlay-action rainbow-random-hover';
    link.textContent = 'project ↗';
    actions.appendChild(link);
  }
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'overlay-action rainbow-random-hover';
  copy.textContent = 'copy link';
  copy.addEventListener('click', () => {
    const done = () => { copy.textContent = 'copied'; setTimeout(() => { copy.textContent = 'copy link'; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done, done);
    else done();
  });
  actions.appendChild(copy);
  if (position >= 0) {
    const counter = document.createElement('span');
    counter.className = 'overlay-counter';
    counter.textContent = `${position + 1} / ${list.length}`;
    actions.appendChild(counter);
  }
  bar.appendChild(actions);
  overlayContent.appendChild(bar);

  overlay.classList.add('active');
  document.body.classList.add('overlay-open');
}

function openItem(item, mode = 'push') {
  if (!overlay || !overlayContent || !item) return;
  const wasOpen = overlay.classList.contains('active');
  renderOverlay(item);
  setHash(item, wasOpen ? 'replace' : mode);
}

function stepOverlay(delta) {
  if (!overlayItem) return;
  const list = overlayList();
  if (!list.length) return;
  const index = list.indexOf(overlayItem);
  const next = list[(index + delta + list.length) % list.length];
  renderOverlay(next);
  setHash(next, 'replace');
}

function closeOverlay({ fromHistory = false } = {}) {
  if (!overlay || !overlayContent || !overlay.classList.contains('active')) return;
  overlay.classList.remove('active');
  document.body.classList.remove('overlay-open');
  overlayContent.innerHTML = '';
  overlayItem = null;
  if (fromHistory) return;
  if (overlayPushedHistory) {
    overlayPushedHistory = false;
    history.back();
  } else {
    setHash(null, 'replace');
  }
}

function setupOverlayControls() {
  if (!overlay) return;

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'overlay-nav overlay-nav--prev';
  prev.setAttribute('aria-label', 'Previous work');
  prev.textContent = '←';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'overlay-nav overlay-nav--next';
  next.setAttribute('aria-label', 'Next work');
  next.textContent = '→';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'overlay-close rainbow-random-hover';
  close.setAttribute('aria-label', 'Close');
  close.textContent = 'close';
  overlay.append(prev, next, close);

  prev.addEventListener('click', (e) => { e.stopPropagation(); stepOverlay(-1); });
  next.addEventListener('click', (e) => { e.stopPropagation(); stepOverlay(1); });
  close.addEventListener('click', (e) => { e.stopPropagation(); closeOverlay(); });

  // click on the empty backdrop or on the picture itself closes, like before
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('.overlay-bar')) return;
    closeOverlay();
  });

  document.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('active')) return;
    if (e.key === 'Escape') closeOverlay();
    if (e.key === 'ArrowRight') stepOverlay(1);
    if (e.key === 'ArrowLeft') stepOverlay(-1);
  });

  // swipe left/right to flip, down to close
  let startX = 0;
  let startY = 0;
  overlay.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  overlay.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      stepOverlay(dx < 0 ? 1 : -1);
      overlay.dataset.swiped = '1';
      setTimeout(() => { delete overlay.dataset.swiped; }, 400);
    } else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) {
      closeOverlay();
    }
  }, { passive: true });
  // a swipe also fires a click — don't let it close the overlay
  overlay.addEventListener('click', (e) => {
    if (overlay.dataset.swiped) e.stopImmediatePropagation();
  }, true);

  window.addEventListener('popstate', () => {
    const item = findItemBySlug(location.hash.slice(1));
    if (item) {
      renderOverlay(item);
    } else {
      overlayPushedHistory = false;
      closeOverlay({ fromHistory: true });
    }
  });
}

setupOverlayControls();

function openFromHash() {
  const item = findItemBySlug(location.hash.slice(1));
  if (item) openItem(item, 'replace');
}

// --------------------
// MEDIA HELPERS
// --------------------
function getMediaType(url) {
  if (!url) return 'unknown';
  const ext = url.split('.').pop().toLowerCase();
  if (['webm', 'mp4', 'mov'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  return 'unknown';
}

function parseDateValue(dateValue) {
  const timestamp = Date.parse(dateValue);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortItemsByDate() {
  items.sort((a, b) => {
    const dateA = parseDateValue(a.date);
    const dateB = parseDateValue(b.date);
    return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
  });
}

function updateSortToggleLabel() {
  if (!sortToggleButton) return;
  sortToggleButton.textContent = sortDirection === 'desc' ? 'date ↓' : 'date ↑';
}

function toggleSortDirection() {
  sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
  updateSortToggleLabel();
  sortItemsByDate();
  resetRender();
}

// assets/pics/Name.jpg → assets/pics/thumbs/Name.webp (built by scripts/optimize_media.py)
function getThumbUrl(url) {
  const match = /assets\/pics\/([^/?#]+)\.(jpe?g|png|webp|gif)(?:[?#].*)?$/i.exec(url || '');
  if (!match) return '';
  return `${url.slice(0, match.index)}assets/pics/thumbs/${match[1]}.webp`;
}

// videos start downloading only when they get close to the screen, and pause off-screen
const videoObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    entries.forEach(({ target: video, isIntersecting }) => {
      if (isIntersecting) {
        if (!video.getAttribute('src')) video.src = video.dataset.src;
        const playing = video.play();
        if (playing) playing.catch(() => {});
      } else if (!video.paused) {
        video.pause();
      }
    });
  }, { rootMargin: '300px 0px' })
  : null;

function createMediaElement(url) {
  const type = getMediaType(url);

  if (type === 'video') {
    const video = document.createElement('video');
    video.dataset.src = url;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'none';
    if (videoObserver) {
      videoObserver.observe(video);
    } else {
      video.src = url;
      video.autoplay = true;
    }
    return video;
  }

  const img = document.createElement('img');
  const thumb = getThumbUrl(url);
  img.dataset.full = url;
  img.loading = 'lazy';
  img.decoding = 'async';
  if (thumb) {
    // no thumbnail yet (e.g. right after upload) → quietly fall back to the original
    img.addEventListener('error', () => {
      if (img.src !== url) img.src = url;
    }, { once: true });
  }
  img.src = thumb || url;
  return img;
}

function hueDistance(a, b) {
  if (a === null || b === null || Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  const distance = Math.abs(a - b);
  return Math.min(distance, 360 - distance);
}

function itemMatchesHue(item) {
  if (currentHue === null) return true;
  if (Number.isNaN(item.dominantHue)) return false;
  return hueDistance(item.dominantHue, currentHue) <= HUE_TOLERANCE;
}

function getFilteredItems() {
  const byTag = currentFilter === 'all'
    ? items
    : items.filter(i => i.tags.includes(currentFilter));

  return byTag.filter(itemMatchesHue);
}

function getItemKey(item) {
  return item.id || item.image;
}

function getOrCreateCard(item) {
  const key = getItemKey(item);
  if (cardCache.has(key)) return cardCache.get(key);

  const card = createCard(item);
  cardCache.set(key, card);
  return card;
}

function resetRender() {
  visibleItems = getFilteredItems();
  currentIndex = 0;
  grid.innerHTML = '';
  initMasonryColumns();
  renderNextBatch();
}

function getColumnCount() {
  if (window.innerWidth <= 1000) return 2;
  if (window.innerWidth <= 1400) return 3;
  return 4;
}

function initMasonryColumns() {
  if (!grid) return;

  const columnCount = getColumnCount();
  masonryColumns = [];
  nextColumnIndex = 0;

  for (let i = 0; i < columnCount; i++) {
    const column = document.createElement('div');
    column.classList.add('masonry-column');
    masonryColumns.push(column);
    grid.appendChild(column);
  }
}

// --------------------
// CARD CREATION
// --------------------
function createCard(item) {
  const card = document.createElement('div');
  card.classList.add('card');

  const mediaWrapper = document.createElement('div');
  mediaWrapper.classList.add('media-wrapper');
  mediaWrapper.style.aspectRatio = item.aspectRatio;

  const media = createMediaElement(item.image);

  if (media.tagName === 'IMG') {
    media.addEventListener('load', () => mediaWrapper.classList.add('loaded'));
  }

  if (media.tagName === 'VIDEO') {
    media.addEventListener('loadeddata', () => mediaWrapper.classList.add('loaded'));
  }

  media.addEventListener('click', () => openItem(item));

  mediaWrapper.appendChild(media);
  card.appendChild(mediaWrapper);

  if (item.caption) {
    const caption = document.createElement('p');
    caption.textContent = item.caption;
    card.appendChild(caption);
  }

  const meta = document.createElement('div');
  meta.classList.add('card-meta');

  const dateEl = document.createElement('span');
  dateEl.classList.add('card-date');
  dateEl.textContent = formatDate(item.date);
  meta.appendChild(dateEl);

  const tagsEl = document.createElement('span');
  tagsEl.classList.add('card-tags');

  item.tags.slice(0, 2).forEach((tag) => {
    const tagSpan = document.createElement('span');
    tagSpan.textContent = tag;
    tagSpan.classList.add('rainbow-random-hover');
    tagSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      setActiveFilter(tag);
    });
    tagsEl.appendChild(tagSpan);
  });

  meta.appendChild(tagsEl);
  card.appendChild(meta);

  return card;
}

// --------------------
// LAZY BATCH RENDERING
// --------------------
function renderNextBatch() {
  if (currentIndex >= visibleItems.length || masonryColumns.length === 0) return;

  const maxIndex = Math.min(currentIndex + batchSize, visibleItems.length);

  for (let i = currentIndex; i < maxIndex; i++) {
    const column = masonryColumns[nextColumnIndex];
    column.appendChild(getOrCreateCard(visibleItems[i]));
    nextColumnIndex = (nextColumnIndex + 1) % masonryColumns.length;
  }

  currentIndex = maxIndex;
}

// --------------------
// FILTER LOGIC
// --------------------
function setActiveFilter(filter) {
  currentFilter = filter;

  document.querySelectorAll('.filters button').forEach((button) => {
    button.classList.remove('active');
  });

  const activeBtn = document.querySelector(`.filters button[data-filter="${filter}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    setRandomRainbowPhase(activeBtn);
  }

  resetRender();
}

function setHueFilter(hue) {
  currentHue = hue;
  updateHueSliderHandleColor();
  resetRender();
}

function updateHueToggleState() {
  if (!hueToggleButton || !hueFilterPanel) return;
  const isOpen = !hueFilterPanel.hasAttribute('hidden');
  hueToggleButton.classList.toggle('is-open', isOpen);
  hueToggleButton.setAttribute('aria-expanded', String(isOpen));
}

function updateHueSliderHandleColor() {
  if (!hueSlider) return;
  const hue = Number(hueSlider.value);
  const thumbLightness = 50;
  const outlineLightness = Math.min(95, thumbLightness + 30);
  const outlineWidth = thumbLightness < 58 ? '2.5px' : '2px';

  hueSlider.style.setProperty('--thumb-color', `hsl(${hue} 100% ${thumbLightness}%)`);
  hueSlider.style.setProperty('--thumb-outline-color', `hsl(${hue} 100% ${outlineLightness}%)`);
  hueSlider.style.setProperty('--thumb-outline-width', outlineWidth);
}

function syncHueFilterVisibility() {
  if (!hueFilterPanel) return;

  if (isMobileViewport()) {
    hueFilterPanel.setAttribute('hidden', '');
    currentHue = null;
    if (hueSlider) {
      hueSlider.value = 0;
      updateHueSliderHandleColor();
    }
    resetRender();
    updateHueToggleState();
    return;
  }

  hueFilterPanel.removeAttribute('hidden');
  updateHueToggleState();
}

function setupHueFilterControls() {
  if (!hueSlider || !hueToggleButton || !hueFilterPanel) return;

  hueSlider.disabled = false;
  updateHueSliderHandleColor();
  syncHueFilterVisibility();

  hueSlider.addEventListener('input', () => {
    setHueFilter(Number(hueSlider.value));
  });

  hueToggleButton.addEventListener('click', () => {
    const isHidden = hueFilterPanel.hasAttribute('hidden');
    if (isHidden) {
      hueFilterPanel.removeAttribute('hidden');
      updateHueToggleState();
      return;
    }

    hueFilterPanel.setAttribute('hidden', '');
    currentHue = null;
    hueSlider.value = 0;
    updateHueSliderHandleColor();
    updateHueToggleState();
    resetRender();
  });
}

function setupFilterScrollGuard() {
  if (!filtersContainer) return;

  let pointerDownX = 0;
  let pointerDownY = 0;
  let pointerMoved = false;
  let suppressClicksUntil = 0;
  let lastScrollLeft = filtersContainer.scrollLeft;

  const isGuardActive = (event) => isMobileViewport() || event?.pointerType === 'touch';

  const markDragging = () => {
    pointerMoved = true;
    suppressClicksUntil = performance.now() + 250;
  };

  filtersContainer.addEventListener('pointerdown', (event) => {
    if (!isGuardActive(event)) {
      pointerMoved = false;
      return;
    }

    pointerDownX = event.clientX;
    pointerDownY = event.clientY;
    pointerMoved = false;
    lastScrollLeft = filtersContainer.scrollLeft;
  }, { passive: true });

  filtersContainer.addEventListener('pointermove', (event) => {
    if (!isGuardActive(event)) return;

    if (Math.abs(event.clientX - pointerDownX) > 8 || Math.abs(event.clientY - pointerDownY) > 8) {
      markDragging();
    }
  }, { passive: true });

  filtersContainer.addEventListener('scroll', () => {
    if (!isMobileViewport()) {
      lastScrollLeft = filtersContainer.scrollLeft;
      return;
    }

    if (Math.abs(filtersContainer.scrollLeft - lastScrollLeft) > 4) {
      markDragging();
      lastScrollLeft = filtersContainer.scrollLeft;
    }
  }, { passive: true });

  filtersContainer.addEventListener('pointerup', (event) => {
    if (!isGuardActive(event)) return;

    if (pointerMoved) {
      suppressClicksUntil = performance.now() + 250;
    }
  }, { passive: true });

  filtersContainer.addEventListener('pointercancel', (event) => {
    if (!isGuardActive(event)) return;

    if (pointerMoved) {
      suppressClicksUntil = performance.now() + 250;
    }
  }, { passive: true });

  filtersContainer.addEventListener('click', (event) => {
    const filterButton = event.target.closest('button');
    if (!filterButton || !isMobileViewport()) return;

    if (!pointerMoved && performance.now() > suppressClicksUntil) return;

    event.preventDefault();
    event.stopPropagation();
    pointerMoved = false;
  }, true);
}

// --------------------
// SCROLL LISTENER
// --------------------
window.addEventListener('scroll', () => {
  const scrollPosition = window.scrollY + window.innerHeight;
  const gridBottom = grid.offsetTop + grid.offsetHeight;

  if (scrollPosition > gridBottom - 200) {
    renderNextBatch();
  }
});

window.addEventListener('resize', () => {
  const isMobile = isMobileViewport();

  if (isMobile !== wasMobileViewport) {
    wasMobileViewport = isMobile;
    syncHueFilterVisibility();
  }

  const desiredColumns = getColumnCount();
  if (desiredColumns !== masonryColumns.length) {
    resetRender();
  }
});

function parseColorIndexRows(text) {
  const map = new Map();
  parseCsv(text).forEach((row) => {
    const image = (row.image || '').trim();
    if (!image) return;

    const colorMetrics = {
      dominantHue: Number(row.dominantHue),
      secondaryHue: Number(row.secondaryHue),
      weight: Number(row.weight),
      saturation: Number(row.saturation)
    };

    map.set(image, colorMetrics);

    const normalized = normalizeImageKey(image);
    if (normalized) {
      map.set(normalized, colorMetrics);
      const fileName = fileNameFromImageRef(image);
      if (fileName) map.set(fileName, colorMetrics);
    }
  });

  return map;
}

function getColorMetrics(imageRef, colorIndex) {
  if (!imageRef) return {};

  return colorIndex.get(imageRef)
    || colorIndex.get(normalizeImageKey(imageRef))
    || colorIndex.get(fileNameFromImageRef(imageRef))
    || {};
}

// "/assets/pics/x.jpg" (Pages CMS style) → "assets/pics/x.jpg", so it works under /gallery01/
function resolveAsset(ref) {
  const value = String(ref || '').trim();
  if (!value || /^https?:\/\//i.test(value)) return value;
  return value.replace(/^\/+/, '');
}

// small CSV reader for the colour index (replaces the PapaParse CDN dependency)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  const header = rows.shift() || [];
  return rows.map(r => Object.fromEntries(header.map((key, i) => [key, r[i] || ''])));
}

function buildItems(dataRows, colorIndex) {
  return dataRows.map((item) => {
    let aspectRatio = 1;

    if (item.resolution) {
      const [w, h] = item.resolution.split('x').map(Number);
      if (w && h) aspectRatio = w / h;
    }

    const image = resolveAsset(item.image || '');
    const color = getColorMetrics(image, colorIndex);
    const tags = Array.isArray(item.tags) ? item.tags : String(item.tags || '').split(',');

    return {
      id: item.id,
      date: item.date,
      image,
      tags: tags.map(t => String(t).trim()).filter(Boolean),
      project_url: item.project_url || '',
      caption: item.caption || '',
      aspectRatio,
      dominantHue: Number(color.dominantHue),
      secondaryHue: Number(color.secondaryHue),
      colorWeight: Number(color.weight),
      colorSaturation: Number(color.saturation)
    };
  });
}

function renderTagFilters() {
  const allTags = [...new Set(items.flatMap(item => item.tags))];

  const allBtn = document.createElement('button');
  allBtn.textContent = 'all';
  allBtn.dataset.filter = 'all';
  allBtn.classList.add('active', 'rainbow-random-hover');
  setRandomRainbowPhase(allBtn);
  filtersContainer.appendChild(allBtn);
  allBtn.addEventListener('click', () => setActiveFilter('all'));

  allTags.forEach(tag => {
    const btn = document.createElement('button');
    btn.textContent = tag;
    btn.dataset.filter = tag;
    btn.classList.add('rainbow-random-hover');
    filtersContainer.appendChild(btn);
    btn.addEventListener('click', () => setActiveFilter(tag));
  });
}

// --------------------
// LOAD DATA
// --------------------
let colorIndexMap = new Map();
let controlsReady = false;

function applyRows(rows) {
  cardCache.clear();
  items = buildItems(rows, colorIndexMap);
  sortItemsByDate();

  filtersContainer.innerHTML = '';
  renderTagFilters();

  if (!controlsReady) {
    controlsReady = true;
    setupHueFilterControls();
    updateSortToggleLabel();
  }

  setActiveFilter(currentFilter);
}

Promise.all([
  fetch(SHARDS_URL, { cache: 'no-cache' }).then(res => (res.ok ? res.json() : [])),
  fetch(COLOR_INDEX_URL, { cache: 'no-cache' }).then(res => (res.ok ? res.text() : '')).catch(() => '')
])
  .then(([shards, colorText]) => {
    colorIndexMap = colorText ? parseColorIndexRows(colorText) : new Map();
    const rows = (Array.isArray(shards) ? shards : [])
      .filter(row => row && row.image && !row.hidden);
    applyRows(rows);
    openFromHash();
  })
  .catch(err => console.error('Ошибка загрузки работ:', err));

if (sortToggleButton) {
  sortToggleButton.addEventListener('click', toggleSortDirection);
}
