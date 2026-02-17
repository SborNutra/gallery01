const items = [
  { id:1, category:'motion', img:'/assets/m1.jpg' },
  …
];

const buttons = document.querySelectorAll('.filters button');
buttons.forEach(btn => {
  btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    renderItems();
  });
});

function renderItems() {
  grid.innerHTML = '';
  items.filter(i => filter=='all' || i.category==filter)
       .forEach(i => addCard(i));
}
