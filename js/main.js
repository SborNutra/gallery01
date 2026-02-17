const grid = document.querySelector('.masonry-grid');

const items = [
  { id: 1, category: 'motion', img: 'https://picsum.photos/400/600' },
  { id: 2, category: '3d', img: 'https://picsum.photos/400/400' },
  { id: 3, category: 'abstract', img: 'https://picsum.photos/400/700' },
  { id: 4, category: 'motion', img: 'https://picsum.photos/400/500' },
  { id: 5, category: '3d', img: 'https://picsum.photos/400/650' }
];

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

const buttons = document.querySelectorAll('.filters button');

buttons.forEach(btn => {
  btn.addEventListener('click', () => {
    // убираем активный класс у всех
    buttons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const filter = btn.dataset.filter;
    renderItems(filter);
  });
});

renderItems();
