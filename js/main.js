
const grid = document.querySelector('.masonry-grid');
const filtersContainer = document.querySelector('.filters');

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRb9gChhvriuPLiHwT0yJ7zOcxHsyNNxkGQsBRMreZHFxv_oIvgOZil9mdeLiF-LvBp_onplkqZtMLR/pub?gid=0&single=true&output=csv';

let items = [];
let batchSize = 20;
let currentIndex = 0;
let currentFilter = 'all';

// --------------------
// OVERLAY LOGIC
// --------------------
const overlay = document.getElementById('overlay');
const overlayContent = overlay ? overlay.querySelector('.overlay-content') : null;

// Открываем оверлей с уже загруженным элементом (видео или картинка)
function openOverlay(mediaElement) {
  if (!overlay || !overlayContent || !mediaElement) return;

  overlayContent.innerHTML = '';

  // создаём клон
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

// Закрываем оверлей и возвращаем видео обратно в карточку
function closeOverlay() {
  if (!overlay || !overlayContent) return;

  overlay.classList.remove('active');
  overlayContent.innerHTML = '';
}

// Клик по фону оверлея закрывает его
overlay?.addEventListener('click', closeOverlay);

// ESC закрывает оверлей
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

// Создаём медиа элемент для карточки (img или video)
function createMediaElement(url) {
  const type = getMediaType(url);

  if (type === "video") {
    const video = document.createElement("video");
    video.src = url;
    video.autoplay = true;     // для батчевой загрузки видео сразу играет
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata"; // быстро подгружается только метадата
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
  media.addEventListener("click", () => openOverlay(media));
  card.appendChild(media);

  // подпись под картинкой
  if (item.caption) {
    const caption = document.createElement("p");
    caption.textContent = item.caption;
    card.appendChild(caption);
  }

  // meta блок: дата + теги
  const meta = document.createElement("div");
  meta.classList.add("card-meta");

  // дата
  const dateEl = document.createElement("span");
  dateEl.classList.add("card-date");
  dateEl.textContent = item.date || '';
  meta.appendChild(dateEl);

  // теги
  const tagsEl = document.createElement("span");
  tagsEl.classList.add("card-tags");

  if (item.tags && item.tags.length) {
    item.tags.forEach((tag, index) => {
      const tagEl = document.createElement("span");
      tagEl.textContent = tag;
      tagEl.style.cursor = "pointer";
      tagEl.style.marginLeft = index === 0 ? '0' : '0.25rem';

      // навешиваем клик, который переключает фильтр
      tagEl.addEventListener("click", (e) => {
        e.stopPropagation(); // чтобы клик по тегу не открывал оверлей
        setActiveFilter(tag);
      });

      tagsEl.appendChild(tagEl);
    });
  }

  meta.appendChild(tagsEl);
  card.appendChild(meta);

  return card;
}

// --------------------
// LAZY BATCH RENDERING
// --------------------
function renderNextBatch(filter = 'all') {
  const filtered = filter === 'all' ? items : items.filter(i => i.tags.includes(filter));
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
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

    items = parsed.data.map(item => ({
      id: item.id,
      date: item.date,
      image: item.image,
      tags: item.tags ? item.tags.split(',').map(t => t.trim()) : [],
      project_url: item.project_url || '',
      caption: item.caption || ''
    }));

    // Сортировка по дате (новые сверху)
    items.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Создаём кнопки фильтров
    const allTags = [...new Set(items.flatMap(item => item.tags))];

    const allBtn = document.createElement('button');
    allBtn.textContent = 'all';
    allBtn.dataset.filter = 'all';
    allBtn.classList.add('active');
    filtersContainer.appendChild(allBtn);
    allBtn.addEventListener('click', () => setActiveFilter('all'));

    allTags.forEach(tag => {
      const btn = document.createElement('button');
      btn.textContent = tag;
      btn.dataset.filter = tag;
      filtersContainer.appendChild(btn);
      btn.addEventListener('click', () => setActiveFilter(tag));
    });

    // Первый рендер
    renderNextBatch(currentFilter);
  })
  .catch(err => console.error("Ошибка загрузки CSV:", err));
