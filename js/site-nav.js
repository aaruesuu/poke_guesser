(() => {
  const hamburgerMenu = document.getElementById('hamburger-menu');
  const navMenu = document.getElementById('nav-menu');

  if (!hamburgerMenu || !navMenu) return;

  const closeMenu = () => {
    hamburgerMenu.classList.remove('is-active');
    navMenu.classList.remove('is-active');
  };

  hamburgerMenu.addEventListener('click', () => {
    hamburgerMenu.classList.toggle('is-active');
    navMenu.classList.toggle('is-active');
  });

  navMenu.querySelectorAll('a, button').forEach((item) => {
    item.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', (event) => {
    if (!navMenu.contains(event.target) && !hamburgerMenu.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
    }
  });
})();
