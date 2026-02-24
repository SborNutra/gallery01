(function renderHeader() {
  const headerRoot = document.querySelector('[data-site-header]');
  if (!headerRoot) return;

  headerRoot.innerHTML = `
    <header class="header">
      <div class="header__inner">
        <a href="about.html" class="header__avatar">
          <img src="assets/avatar.jpg" alt="About">
        </a>

        <nav class="header__nav">
          <a href="cases.html" data-nav="cases" class="rainbow-hover">cases</a>
          <a href="index.html" data-nav="shards" class="rainbow-hover">shards</a>
        </nav>

        <a href="https://t.me/sbor_ntra"
          target="_blank"
          rel="noopener noreferrer"
          class="header__tg rainbow-hover">
          telegram
        </a>
      </div>
    </header>
  `;

  const page = document.body.dataset.page;
  if (!page) return;

  const activeLink = headerRoot.querySelector(`[data-nav="${page}"]`);
  if (!activeLink) return;

  activeLink.removeAttribute('href');
  activeLink.classList.add('active');
  activeLink.classList.remove('rainbow-hover');
  activeLink.setAttribute('aria-current', 'page');
})();

(function initCustomScrollbar() {
  const scrollbar = document.createElement('div');
  scrollbar.className = 'chatgpt-scrollbar';
  scrollbar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(scrollbar);

  let lineCount = 0;

  function getTargetLineCount() {
    const viewportHeight = window.innerHeight;
    const fullHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );
    const maxScroll = Math.max(fullHeight - viewportHeight, 0);

    if (maxScroll <= 0) return 0;

    const pages = fullHeight / Math.max(viewportHeight, 1);
    return Math.min(90, Math.max(8, Math.round(pages * 10)));
  }

  function renderLines(nextCount) {
    if (nextCount === lineCount) return;

    scrollbar.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < nextCount; i += 1) {
      const line = document.createElement('span');
      line.className = 'chatgpt-scrollbar__line';
      fragment.appendChild(line);
    }

    scrollbar.appendChild(fragment);
    lineCount = nextCount;
  }

  function updateActiveLines() {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
    const currentLine = Math.round(progress * Math.max(lineCount - 1, 0));

    scrollbar.childNodes.forEach((line, index) => {
      line.classList.remove('is-active', 'is-near', 'is-far');

      const distance = Math.abs(index - currentLine);
      if (distance === 0) {
        line.classList.add('is-active');
      } else if (distance === 1) {
        line.classList.add('is-near');
      } else if (distance === 2) {
        line.classList.add('is-far');
      }
    });
  }

  function updateScrollbar() {
    const nextCount = getTargetLineCount();
    scrollbar.classList.toggle('is-hidden', nextCount === 0);
    renderLines(nextCount);

    if (nextCount === 0) return;
    updateActiveLines();
  }

  let lastKnownScrollHeight = 0;

  function syncScrollbarSize() {
    const currentScrollHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );

    if (currentScrollHeight === lastKnownScrollHeight) return;
    lastKnownScrollHeight = currentScrollHeight;
    updateScrollbar();
  }

  updateScrollbar();
  syncScrollbarSize();

  window.addEventListener('load', syncScrollbarSize);
  window.addEventListener('resize', syncScrollbarSize);
  window.addEventListener('scroll', () => {
    syncScrollbarSize();
    updateActiveLines();
  }, { passive: true });

  const observer = new MutationObserver(syncScrollbarSize);
  observer.observe(document.body, { childList: true, subtree: true });
})();
