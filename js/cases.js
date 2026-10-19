// Cases page. Data lives in data/cases.json — edit it by hand or via Pages CMS (.pages.yml).
(function initCases() {
  const DATA_URL = 'data/cases.json';
  const grid = document.querySelector('.cases-grid');
  const filtersContainer = document.querySelector('.filters');
  if (!grid || !filtersContainer) return;

  let cases = [];
  let currentFilter = 'all';

  function setRandomRainbowPhase(element) {
    element.style.setProperty('--rainbow-start', `${(Math.random() * 200).toFixed(2)}%`);
    element.style.setProperty('--rainbow-delay', `${(-Math.random() * 4).toFixed(2)}s`);
  }

  document.addEventListener('mouseenter', (event) => {
    const target = event.target.closest && event.target.closest('.filters button, .case-tags span');
    if (target) setRandomRainbowPhase(target);
  }, true);

  // "/assets/cases/x.jpg" (Pages CMS style) → "assets/cases/x.jpg", so it works under /gallery01/
  function resolveMedia(ref) {
    if (!ref) return '';
    const value = String(ref).trim();
    if (/^https?:\/\//i.test(value)) return value;
    return value.replace(/^\/+/, '');
  }

  function isVideo(url) {
    return /\.(webm|mp4|mov)(\?|#|$)/i.test(url);
  }

  function normalizeTags(tags) {
    if (Array.isArray(tags)) return tags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
    if (typeof tags === 'string') return tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    return [];
  }

  function createMedia(url, title) {
    if (isVideo(url)) {
      const video = document.createElement('video');
      Object.assign(video, { src: url, autoplay: true, loop: true, muted: true, playsInline: true, preload: 'metadata' });
      return video;
    }
    const img = document.createElement('img');
    img.src = url;
    img.alt = title;
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }

  function createCard(item) {
    const card = document.createElement(item.url ? 'a' : 'div');
    card.className = 'case-card';
    if (item.featured) card.classList.add('case-card--featured');
    if (item.url) {
      card.href = item.url;
      if (/^https?:\/\//i.test(item.url)) {
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
      }
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'media-wrapper case-media';
    if (item.cover) {
      const media = createMedia(item.cover, item.title);
      const markLoaded = () => wrapper.classList.add('loaded');
      media.addEventListener(media.tagName === 'VIDEO' ? 'loadeddata' : 'load', markLoaded);
      media.addEventListener('error', markLoaded);
      wrapper.appendChild(media);
    }
    card.appendChild(wrapper);

    const meta = document.createElement('div');
    meta.className = 'case-meta';

    const titleBlock = document.createElement('div');
    titleBlock.className = 'case-title-block';
    const title = document.createElement('h2');
    title.className = 'case-title';
    title.textContent = item.title;
    titleBlock.appendChild(title);
    if (item.subtitle) {
      const sub = document.createElement('p');
      sub.className = 'case-subtitle';
      sub.textContent = item.subtitle;
      titleBlock.appendChild(sub);
    }
    meta.appendChild(titleBlock);

    const side = document.createElement('div');
    side.className = 'case-side';
    if (item.year) {
      const year = document.createElement('span');
      year.className = 'case-year';
      year.textContent = item.year;
      side.appendChild(year);
    }
    const tags = document.createElement('span');
    tags.className = 'case-tags';
    item.tags.forEach((tag) => {
      const tagEl = document.createElement('span');
      tagEl.textContent = tag;
      tagEl.className = 'rainbow-random-hover';
      tagEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setActiveFilter(tag);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      tags.appendChild(tagEl);
    });
    side.appendChild(tags);
    meta.appendChild(side);

    card.appendChild(meta);
    return card;
  }

  function render() {
    const visible = currentFilter === 'all'
      ? cases
      : cases.filter(item => item.tags.includes(currentFilter));

    grid.innerHTML = '';
    visible.forEach(item => grid.appendChild(createCard(item)));
  }

  function setActiveFilter(filter) {
    currentFilter = filter;
    filtersContainer.querySelectorAll('button').forEach((btn) => {
      const isActive = btn.dataset.filter === filter;
      btn.classList.toggle('active', isActive);
      if (isActive) setRandomRainbowPhase(btn);
    });
    render();
  }

  function renderFilters() {
    // tags ordered by how often they're used, so the main ones come first
    const counts = new Map();
    cases.forEach(item => item.tags.forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    const tags = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));

    ['all', ...tags].forEach((tag) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = tag;
      btn.dataset.filter = tag;
      btn.classList.add('rainbow-random-hover');
      if (tag === 'all') {
        btn.classList.add('active');
        setRandomRainbowPhase(btn);
      }
      btn.addEventListener('click', () => setActiveFilter(tag));
      filtersContainer.appendChild(btn);
    });
  }

  fetch(DATA_URL, { cache: 'no-cache' })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const list = Array.isArray(data) ? data : (data.cases || []);
      cases = list
        .filter(item => item && item.title && !item.hidden)
        .map(item => ({
          title: String(item.title),
          subtitle: item.subtitle ? String(item.subtitle) : '',
          year: item.year ? String(item.year) : '',
          cover: resolveMedia(item.cover),
          tags: normalizeTags(item.tags),
          url: item.url ? String(item.url).trim() : '',
          featured: Boolean(item.featured)
        }));
      renderFilters();
      render();
    })
    .catch(err => console.error('Ошибка загрузки кейсов:', err));
})();
