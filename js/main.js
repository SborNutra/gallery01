const grid = document.querySelector('.masonry-grid');

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRb9gChhvriuPLiHwT0yJ7zOcxHsyNNxkGQsBRMreZHFxv_oIvgOZil9mdeLiF-LvBp_onplkqZtMLR/pub?gid=0&single=true&output=csv';

let items = [];

function getMediaType(url) {
  const extension = url.split('.').pop().toLowerCase()

  if (["webm", "mp4", "mov"].includes(extension)) return "video"
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image"

  return "unknown"
}

function createMediaElement(url) {
  const type = getMediaType(url)

  if (type === "video") {
    const video = document.createElement("video")
    video.src = url
    video.autoplay = true
    video.loop = true
    video.muted = true
    video.playsInline = true
    video.preload = "metadata"
    return video
  }

  const img = document.createElement("img")
  img.src = url
  img.loading = "lazy"
  return img
}

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
      tags: item.tags ? item.tags.split(',').map(t => t.trim()) : [],
      project_url: item.project_url || '',
      caption: item.caption || ''
    }));

    // сортировка по дате (новые сверху)
    items.sort((a, b) => new Date(b.date) - new Date(a.date));

    renderItems();
  });

function renderItems(filter = 'all') {
  grid.innerHTML = '';

  const filtered = filter === 'all'
    ? items
    : items.filter(item => item.tags.includes(filter));

  filtered.forEach(item => {

    const card = document.createElement("div");
    card.classList.add("card");

    // 1. создаём медиа
    const media = createMediaElement(item.image);
    card.appendChild(media);

    // 2. добавляем подпись отдельно
    if (item.caption) {
      const caption = document.createElement("p");
      caption.textContent = item.caption;
      card.appendChild(caption);
    }

    grid.appendChild(card);
  });
}

// --- фильтры кнопок ---
const buttons = document.querySelectorAll('.filters button');

buttons.forEach(btn => {
  btn.addEventListener('click', () => {
    buttons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const filter = btn.dataset.filter;
    renderItems(filter);
  });
});

// --- первый рендер — показываем все карточки сразу ---
renderItems();
