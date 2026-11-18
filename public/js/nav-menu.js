// The dots menu is a <details> element, so opening it, Escape-to-close from the
// keyboard and following the links all work without JavaScript. This only adds
// closing it when the page is clicked somewhere else.
(() => {
  const menu = document.querySelector(".navover");
  if (!menu) return;
  const summary = menu.querySelector("summary");

  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.open) return;
    menu.open = false;
    summary?.focus();
  });
})();
