// Cases page. Data lives in data/cases.json — edit it by hand or via Pages CMS (.pages.yml).
(function initCases() {
  const DATA_URL = 'data/cases.json';
  const SLIDE_INTERVAL = 1100;
  const grid = document.querySelector('.cases-grid');
  if (!grid) return;

  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // "/assets/cases/x.webp" (Pages CMS style) → "assets/cases/x.webp", so it works under /gallery01/
  function resolveMedia(ref) {
    if (!ref) return '';
    const value = String(ref).trim();
    if (/^https?:\/\//i.test(value)) return value;
    return value.replace(/^\/+/, '');
  }

  function isVideo(url) {
    return /\.(webm|mp4|mov)(\?|#|$)/i.test(url);
  }

  function toList(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
    return [];
  }

  function createMedia(url, alt, eager) {
    if (isVideo(url)) {
      const video = document.createElement('video');
      Object.assign(video, { src: url, autoplay: true, loop: true, muted: true, playsInline: true, preload: 'metadata' });
      return video;
    }
    const img = document.createElement('img');
    img.alt = alt;
    img.decoding = 'async';
    img.loading = eager ? 'eager' : 'lazy';
    if (eager) img.fetchPriority = 'high';
    img.src = url;
    return img;
  }

  // --------------------
  // HOVER SLIDESHOW
  // --------------------
  function setupSlideshow(card, wrapper, item) {
    if (!item.gallery.length || reducedMotion) return;

    const progress = document.createElement('div');
    progress.className = 'case-progress';
    progress.setAttribute('aria-hidden', 'true');
    const frames = [item.cover, ...item.gallery];
    frames.forEach(() => progress.appendChild(document.createElement('span')));
    wrapper.appendChild(progress);

    let layers = null;
    let index = 0;
    let timer = null;

    function buildLayers() {
      if (layers) return;
      layers = item.gallery.map((src) => {
        const img = document.createElement('img');
        img.className = 'case-slide';
        img.alt = '';
        img.decoding = 'async';
        img.src = src;
        wrapper.insertBefore(img, progress);
        return img;
      });
    }

    function show(next) {
      index = next;
      layers.forEach((img, i) => img.classList.toggle('is-visible', i === index - 1));
      [...progress.children].forEach((bar, i) => bar.classList.toggle('is-active', i === index));
    }

    function tick() {
      const next = (index + 1) % frames.length;
      const layer = layers[next - 1];
      // don't flash an empty frame: wait until the next picture is actually loaded
      if (layer && !(layer.complete && layer.naturalWidth)) {
        layer.addEventListener('load', () => { if (timer) show(next); }, { once: true });
        return;
      }
      show(next);
    }

    function start() {
      buildLayers();
      card.classList.add('is-playing');
      if (timer) return;
      tick();
      timer = setInterval(tick, SLIDE_INTERVAL);
    }

    function stop() {
      card.classList.remove('is-playing');
      clearInterval(timer);
      timer = null;
      if (layers) show(0);
    }

    if (canHover) {
      card.addEventListener('pointerenter', start);
      card.addEventListener('pointerleave', stop);
      card.addEventListener('focus', start);
      card.addEventListener('blur', stop);
      // warm the first frame when the cursor gets close, so the first hover is instant
      card.addEventListener('pointermove', buildLayers, { once: true });
    } else {
      // touch screens: play while the card is in the middle of the screen
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => (entry.isIntersecting ? start() : stop()));
      }, { threshold: 0.75 });
      observer.observe(wrapper);
    }
  }

  // --------------------
  // CARD
  // --------------------
  function createCard(item, position) {
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
      const media = createMedia(item.cover, item.title, position < 3);
      media.classList.add('case-cover');
      const markLoaded = () => wrapper.classList.add('loaded');
      media.addEventListener(media.tagName === 'VIDEO' ? 'loadeddata' : 'load', markLoaded);
      media.addEventListener('error', markLoaded);
      if (media.complete) markLoaded();
      wrapper.appendChild(media);
      setupSlideshow(card, wrapper, item);
    } else {
      // no cover yet: typographic placeholder instead of an endless shimmer
      wrapper.classList.add('loaded', 'case-media--empty');
      const word = document.createElement('span');
      word.className = 'case-placeholder';
      word.textContent = item.title;
      wrapper.appendChild(word);
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
    if (item.tags.length) {
      const tags = document.createElement('span');
      tags.className = 'case-tags';
      item.tags.forEach((tag) => {
        const tagEl = document.createElement('span');
        tagEl.textContent = tag;
        tags.appendChild(tagEl);
      });
      side.appendChild(tags);
    }
    meta.appendChild(side);

    card.appendChild(meta);
    return card;
  }

  function render(cases) {
    const fragment = document.createDocumentFragment();
    const cards = cases.map((item, i) => createCard(item, i));

    // a card left alone in a row of the two-column grid becomes wide (no holes in the grid)
    let run = [];
    const closeRun = () => {
      if (run.length % 2 === 1) run[run.length - 1].classList.add('case-card--featured');
      run = [];
    };
    cards.forEach((card, i) => (cases[i].featured ? closeRun() : run.push(card)));
    closeRun();

    cards.forEach(card => fragment.appendChild(card));
    grid.innerHTML = '';
    grid.appendChild(fragment);
  }

  fetch(DATA_URL, { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const list = Array.isArray(data) ? data : (data.cases || []);
      const cases = list
        .filter(item => item && item.title && !item.hidden)
        .map(item => ({
          title: String(item.title),
          subtitle: item.subtitle ? String(item.subtitle) : '',
          year: item.year ? String(item.year) : '',
          cover: resolveMedia(item.cover),
          gallery: toList(item.gallery).map(resolveMedia).filter(src => src && !isVideo(src)),
          tags: toList(item.tags).map(t => t.toLowerCase()),
          url: item.url ? String(item.url).trim() : '',
          featured: Boolean(item.featured)
        }));
      render(cases);
    })
    .catch(err => console.error('Ошибка загрузки кейсов:', err));
})();
