const grid = document.querySelector('.masonry-grid');
const filtersContainer = document.querySelector('.filters'); // контейнер кнопок

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRb9gChhvriuPLiHwT0yJ7zOcxHsyNNxkGQsBRMreZHFxv_oIvgOZil9mdeLiF-LvBp_onplkqZtMLR/pub?gid=0&single=true&output=csv';

let items = [];

// --- функции для определения типа и создания медиа ---
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

// --- загрузка данных из Google Sheets ---
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

    // --- рендер карточек ---
    renderItems();

    // --- ВСТАВКА НОВОГО КОДА: автоматические кнопки фильтров ---
    // получаем все уникальные теги из таблицы
    const allTags = [...new Set(items.flatMap(item => item.tags))];

    // кнопка "all"
    const allBtn = document.createElement('button');
    allBtn.textContent = 'all';
    allBtn.dataset.filter = 'all';
    allBtn.classList.add('active');
    filtersContainer.appendChild(allBtn);
    allBtn.addEventListener('click', () => renderItems('all'));

    // кнопки для каждого уникального тега
    allTags.forEach(tag => {
      const btn = document.createElement('button');
      btn.textContent = tag;
      btn.dataset.filter = tag;
      filtersContainer.appendChild(btn);

      btn.addEventListener('click', () => {
        // убираем active у всех
        filtersContainer.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        renderItems(tag);
      });
    });
  });

// --- функция рендера карточек ---
function renderItems(filter = 'all') {
  grid.innerHTML = '';

  const filtered = filter === 'all'
    ? items
    : items.filter(item => item.tags.includes(filter));

  filtered.forEach(item => {
    const card = document.createElement("div");
    card.classList.add("card");

    // создаём медиа (img или video)
    const media = createMediaElement(item.image);
    card.appendChild(media);

    // добавляем подпись
    if (item.caption) {
      const caption = document.createElement("p");
      caption.textContent = item.caption;
      card.appendChild(caption);
    }

    grid.appendChild(card);
  });
}
