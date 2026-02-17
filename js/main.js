const grid = document.querySelector('.masonry-grid');

let items = [];

fetch('content/works.json')
  .then(res => res.json())
  .then(data => {
    items = data;
    renderItems();
});

function renderItems(filter = 'all') {
  grid.innerHTML = '';

  const filtered = filter === 'all'
    ? items
    : items.filter(item => item.category === filter);

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.classList.add('card');

    const img = document.createElement('img');
    img.src = item.img;
    img.loading = 'lazy';

    card.appendChild(img);
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
