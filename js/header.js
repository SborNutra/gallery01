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
