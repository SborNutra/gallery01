const grid = document.querySelector('.masonry-grid');
const filtersContainer = document.querySelector('.filters');
const sortToggleButton = document.querySelector('.sort-toggle');
const hueSlider = document.querySelector('#hue-slider');
const hueToggleButton = document.querySelector('.hue-toggle');
const hueFilterPanel = document.querySelector('.hue-filter');

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRb9gChhvriuPLiHwT0yJ7zOcxHsyNNxkGQsBRMreZHFxv_oIvgOZil9mdeLiF-LvBp_onplkqZtMLR/pub?gid=0&single=true&output=csv';
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
    const hoverTarget = event.target.closest('.filters button, .card-tags span');
    if (!hoverTarget) return;

    setRandomRainbowPhase(hoverTarget);
  }, true);
}

applyRandomRainbowStart();
setupRandomRainbowHover();

// --------------------
// OVERLAY LOGIC
// --------------------
const overlay = document.getElementById('overlay');
const overlayContent = overlay ? overlay.querySelector('.overlay-content') : null;

function openOverlay(mediaElement) {
  if (!overlay || !overlayContent || !mediaElement) return;

  overlayContent.innerHTML = '';

  const clone = mediaElement.cloneNode(true);

  if (clone.tagName === 'VIDEO') {
    clone.autoplay = true;
    clone.muted = true;
    clone.loop = true;
    clone.controls = false;
    clone.play();
  }

  overlayContent.appendChild(clone);
  overlay.classList.add('active');
}

function closeOverlay() {
  if (!overlay || !overlayContent) return;
  overlay.classList.remove('active');
  overlayContent.innerHTML = '';
}

overlay?.addEventListener('click', closeOverlay);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeOverlay();
});

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

function createMediaElement(url) {
  const type = getMediaType(url);

  if (type === 'video') {
    const video = document.createElement('video');
    video.src = url;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.loading = 'lazy';
    return video;
  }

  const img = document.createElement('img');
  img.src = url;
  img.loading = 'lazy';
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
  if (window.innerWidth <= 700) return 1;
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

  media.addEventListener('click', () => openOverlay(media));

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
  dateEl.textContent = item.date || '';
  meta.appendChild(dateEl);

  const tagsEl = document.createElement('span');
  tagsEl.classList.add('card-tags');

  item.tags.forEach((tag) => {
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
}

function updateHueSliderHandleColor() {
  if (!hueSlider) return;
  const hue = Number(hueSlider.value);
  hueSlider.style.setProperty('--thumb-color', `hsl(${hue} 100% 50%)`);
}

function setupHueFilterControls() {
  if (!hueSlider || !hueToggleButton || !hueFilterPanel) return;

  hueSlider.disabled = false;
  updateHueSliderHandleColor();
  updateHueToggleState();

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
  const desiredColumns = getColumnCount();
  if (desiredColumns !== masonryColumns.length) {
    resetRender();
  }
});

function parseColorIndexRows(text) {
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true
  });

  const map = new Map();
  parsed.data.forEach((row) => {
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

function buildItems(dataRows, colorIndex) {
  return dataRows.map((item) => {
    let aspectRatio = 1;

    if (item.resolution) {
      const [w, h] = item.resolution.split('x').map(Number);
      if (w && h) aspectRatio = w / h;
    }

    const image = item.image || '';
    const color = getColorMetrics(image, colorIndex);

    return {
      id: item.id,
      date: item.date,
      image,
      tags: item.tags ? item.tags.split(',').map(t => t.trim()) : [],
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
Promise.all([
  fetch(CSV_URL).then(res => res.text()),
  fetch(COLOR_INDEX_URL).then(res => res.ok ? res.text() : '')
])
  .then(([sourceCsvText, colorCsvText]) => {
    const parsed = Papa.parse(sourceCsvText, {
      header: true,
      skipEmptyLines: true
    });

    const colorIndexMap = colorCsvText ? parseColorIndexRows(colorCsvText) : new Map();

    items = buildItems(parsed.data, colorIndexMap);
    sortItemsByDate();
    renderTagFilters();
    setupHueFilterControls();
    updateSortToggleLabel();
    resetRender();
  })
  .catch(err => console.error('Ошибка загрузки CSV:', err));

if (sortToggleButton) {
  sortToggleButton.addEventListener('click', toggleSortDirection);
}
