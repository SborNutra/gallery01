const grid = document.querySelector('.masonry-grid');
const filtersContainer = document.querySelector('.filters');

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRb9gChhvriuPLiHwT0yJ7zOcxHsyNNxkGQsBRMreZHFxv_oIvgOZil9mdeLiF-LvBp_onplkqZtMLR/pub?gid=0&single=true&output=csv';

let items = [];
let batchSize = 20;
let currentIndex = 0;
let currentFilter = 'all';

// --------------------
  // OVERLAY
// --------------------

const overlay = document.getElementById('overlay');
const overlayContent = overlay ? overlay.querySelector('.overlay-content') : null;

function openOverlay(url) {
  if (!overlay || !overlayContent) return;
  overlayContent.innerHTML = '';

  const media = createMediaElement(url);

  // В оверлее видео не автоплей по умолчанию
  if (media.tagName === 'VIDEO') {
    media.autoplay = false;
    media.controls = true;
  }

  overlayContent.appendChild(media);
  overlay.classList.add('active');
}

function closeOverlay() {
  overlay.classList.remove('active');
  overlayContent.innerHTML = '';
}

// клик вне медиа — закрыть
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeOverlay();
});

// ESC закрывает
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeOverlay();
});


// --------------------
// MEDIA HELPERS
// --------------------

function getMediaType(url) {
  if (!url) return "unknown";
  const extension = url.split('.').pop().toLowerCase();

  if (["webm", "mp4", "mov"].includes(extension)) return "video";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image";

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

  const media = createMediaElement(item.image);

  // курсор зума
  media.style.cursor = "zoom-in";
  
  // клик открывает оверлей
  media.addEventListener("click", () => {
    openOverlay(item.image);
  });
  
  card.appendChild(media);


  if (item.caption) {
    const caption = document.createElement("p");
    caption.textContent = item.caption;
    card.appendChild(caption);
  }

  return card;
}


// --------------------
// RENDER LOGIC (LAZY BATCH)
// --------------------

function renderNextBatch(filter = 'all') {
  const filtered = filter === 'all'
    ? items
    : items.filter(i => i.tags.includes(filter));

  if (currentIndex >= filtered.length) return;

  const fragment = document.createDocumentFragment();

  for (
    let i = currentIndex;
    i < Math.min(currentIndex + batchSize, filtered.length);
    i++
  ) {
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

  const activeBtn = document.querySelector(
    `.filters button[data-filter="${filter}"]`
  );

  if (activeBtn) activeBtn.classList.add('active');

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

    items = parsed.data.map(item => ({
      id: item.id,
      date: item.date,
      image: item.image,
      tags: item.tags
        ? item.tags.split(',').map(t => t.trim())
        : [],
      project_url: item.project_url || '',
      caption: item.caption || ''
    }));

    // сортировка по дате (новые сверху)
    items.sort((a, b) => new Date(b.date) - new Date(a.date));

    // создаём фильтры
    const allTags = [...new Set(items.flatMap(item => item.tags))];

    // кнопка ALL
    const allBtn = document.createElement('button');
    allBtn.textContent = 'all';
    allBtn.dataset.filter = 'all';
    allBtn.classList.add('active');
    filtersContainer.appendChild(allBtn);
    allBtn.addEventListener('click', () => setActiveFilter('all'));

    // кнопки тегов
    allTags.forEach(tag => {
      const btn = document.createElement('button');
      btn.textContent = tag;
      btn.dataset.filter = tag;
      filtersContainer.appendChild(btn);
      btn.addEventListener('click', () => setActiveFilter(tag));
    });

    // первый рендер
    renderNextBatch(currentFilter);
  })
  .catch(err => {
    console.error("Ошибка загрузки CSV:", err);
  });
