const grid = document.querySelector('.masonry-grid');
const filtersContainer = document.querySelector('.filters');

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRb9gChhvriuPLiHwT0yJ7zOcxHsyNNxkGQsBRMreZHFxv_oIvgOZil9mdeLiF-LvBp_onplkqZtMLR/pub?gid=0&single=true&output=csv';

let items = [];
let batchSize = 20;
let currentIndex = 0;
let currentFilter = 'all';

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

function applyRandomRainbowStart() {
  const rainbowElements = document.querySelectorAll('.rainbow-hover');

  rainbowElements.forEach((element) => {
    const randomStart = `${(Math.random() * 200).toFixed(2)}%`;
    const randomDelay = `${(-Math.random() * 4).toFixed(2)}s`;

    element.style.setProperty('--rainbow-start', randomStart);
    element.style.setProperty('--rainbow-delay', randomDelay);
  });
}

applyRandomRainbowStart();


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
  if (!url) return "unknown";
  const ext = url.split('.').pop().toLowerCase();
  if (["webm", "mp4", "mov"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  return "unknown";
}

function createMediaElement(url) {
  const type = getMediaType(url);

  if (type === "video") {
    const video = document.createElement("video");
    video.src = url;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.loading = "lazy";
    return video;
  }

  const img = document.createElement("img");
  img.src = url;
  img.loading = "lazy";
  return img;
}


// --------------------
// CARD CREATION
// --------------------
function createCard(item) {
  const card = document.createElement("div");
  card.classList.add("card");

  // --- MEDIA WRAPPER (фиксирует высоту заранее)
  const mediaWrapper = document.createElement("div");
  mediaWrapper.classList.add("media-wrapper");
  mediaWrapper.style.aspectRatio = item.aspectRatio;

  const media = createMediaElement(item.image);

    if (media.tagName === "IMG") {
    media.addEventListener("load", () => {
      mediaWrapper.classList.add("loaded");
    });
  }
  
  if (media.tagName === "VIDEO") {
    media.addEventListener("loadeddata", () => {
      mediaWrapper.classList.add("loaded");
    });
  }

  media.addEventListener("click", () => openOverlay(media));

  mediaWrapper.appendChild(media);
  card.appendChild(mediaWrapper);

  // caption
  if (item.caption) {
    const caption = document.createElement("p");
    caption.textContent = item.caption;
    card.appendChild(caption);
  }

  // meta
  const meta = document.createElement("div");
  meta.classList.add("card-meta");

  const dateEl = document.createElement("span");
  dateEl.classList.add("card-date");
  dateEl.textContent = item.date || '';
  meta.appendChild(dateEl);

  const tagsEl = document.createElement("span");
  tagsEl.classList.add("card-tags");

  item.tags.forEach((tag) => {
    const tagSpan = document.createElement("span");
    tagSpan.textContent = tag;
    tagSpan.classList.add('rainbow-random-hover');
    tagSpan.addEventListener("click", (e) => {
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
function renderNextBatch(filter = 'all') {
  const filtered = filter === 'all'
    ? items
    : items.filter(i => i.tags.includes(filter));

  if (currentIndex >= filtered.length) return;

  const fragment = document.createDocumentFragment();

  for (let i = currentIndex; i < Math.min(currentIndex + batchSize, filtered.length); i++) {
    fragment.appendChild(createCard(filtered[i]));
  }

  grid.appendChild(fragment);
  currentIndex += batchSize;
}


// --------------------
// FILTER LOGIC
// --------------------
function setActiveFilter(filter) {
  currentFilter = filter;
  currentIndex = 0;
  grid.innerHTML = '';

  document.querySelectorAll('.filters button')
    .forEach(b => b.classList.remove('active'));

  const activeBtn = document.querySelector(`.filters button[data-filter="${filter}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    setRandomRainbowPhase(activeBtn);
  }

  renderNextBatch(filter);
}


// --------------------
// SCROLL LISTENER
// --------------------
window.addEventListener('scroll', () => {
  const scrollPosition = window.scrollY + window.innerHeight;
  const gridBottom = grid.offsetTop + grid.offsetHeight;

  if (scrollPosition > gridBottom - 200) {
    renderNextBatch(currentFilter);
  }
});


// --------------------
// LOAD DATA
// --------------------
fetch(CSV_URL)
  .then(res => res.text())
  .then(text => {
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true
    });

    items = parsed.data.map(item => {

      let aspectRatio = 1;

      if (item.resolution) {
        const [w, h] = item.resolution.split('x').map(Number);
        if (w && h) aspectRatio = w / h;
      }

      return {
        id: item.id,
        date: item.date,
        image: item.image,
        tags: item.tags
          ? item.tags.split(',').map(t => t.trim())
          : [],
        project_url: item.project_url || '',
        caption: item.caption || '',
        aspectRatio
      };
    });

    items.sort((a, b) => new Date(b.date) - new Date(a.date));

    const allTags = [...new Set(items.flatMap(item => item.tags))];

    const allBtn = document.createElement('button');
    allBtn.textContent = 'all';
    allBtn.dataset.filter = 'all';
    allBtn.classList.add('active');
    allBtn.classList.add('rainbow-random-hover');
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

    renderNextBatch(currentFilter);
  })
  .catch(err => console.error("Ошибка загрузки CSV:", err));
