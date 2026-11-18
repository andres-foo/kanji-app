// Keyword suggestions under the nav search bar.
// Typing fetches /suggest, which returns the matching kanji rows. Nothing is
// selected until an arrow key is pressed, so Enter keeps its old meaning: run the
// full search. The Tab conversion from search-romaji.js appears as a row here.
(() => {
  const form = document.querySelector(".navsearch");
  const input = form?.querySelector('input[name="q"]');
  if (!form || !input) return;

  const MIN = 2;
  const DEBOUNCE = 120;

  const panel = document.createElement("div");
  panel.className = "sug";
  panel.id = "search-suggest";
  panel.setAttribute("role", "listbox");
  panel.setAttribute("aria-label", "Search suggestions");
  panel.hidden = true;
  form.appendChild(panel);

  let rows = [];
  let active = -1;
  let timer = 0;
  let controller = null;

  const close = () => {
    panel.hidden = true;
    panel.innerHTML = "";
    rows = [];
    active = -1;
    input.setAttribute("aria-expanded", "false");
  };

  // The panel is wider than the field on narrow screens; keep it inside the window.
  const fitToViewport = () => {
    panel.style.left = "0px";
    const rect = panel.getBoundingClientRect();
    const overflow = rect.right - (window.innerWidth - 12);
    panel.style.left = overflow > 0 ? `${-overflow}px` : "0px";
  };

  const setActive = (index) => {
    if (!rows.length) return;
    active = (index + rows.length) % rows.length;
    rows.forEach((row, i) => {
      row.classList.toggle("active", i === active);
      row.setAttribute("aria-selected", i === active ? "true" : "false");
    });
    rows[active].scrollIntoView({ block: "nearest" });
  };

  const separator = () => {
    const line = document.createElement("div");
    line.className = "sug-sep";
    panel.appendChild(line);
  };

  const conversionRow = (target) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sug-conv";
    button.innerHTML = '<span class="tab-key">Tab</span><span class="tab-arrow">→</span><span class="tab-target"></span><span class="grow"></span><span class="sug-hint">convert</span>';
    button.querySelector(".tab-target").textContent = target;
    button.addEventListener("click", () => window.kanjiRomaji?.apply?.());
    panel.appendChild(button);
  };

  const render = (html, query) => {
    panel.innerHTML = html;
    const hasRows = panel.querySelectorAll(".sug-row").length > 0;
    const target = window.kanjiRomaji?.target?.() ?? null;
    if (!hasRows && !target) {
      close();
      return;
    }
    if (target) {
      if (hasRows) separator();
      conversionRow(target);
    }
    if (hasRows) {
      separator();
      const foot = document.createElement("a");
      foot.className = "sug-foot";
      foot.href = `/?q=${encodeURIComponent(query)}`;
      foot.textContent = `See all results for “${query}”`;
      panel.appendChild(foot);
    }
    rows = [...panel.querySelectorAll(".sug-row")];
    active = -1;
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    fitToViewport();
  };

  const load = async () => {
    const query = input.value.trim();
    if (query.length < MIN) {
      close();
      return;
    }
    controller?.abort();
    controller = new AbortController();
    try {
      const response = await fetch(`/suggest?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      // a newer keystroke already started another request
      if (input.value.trim() !== query) return;
      render(html, query);
    } catch (error) {
      if (error.name !== "AbortError") close();
    }
  };

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(load, DEBOUNCE);
  };

  input.addEventListener("input", () => {
    controller?.abort();
    schedule();
  });
  input.addEventListener("focus", () => {
    if (input.value.trim().length >= MIN) schedule();
  });
  input.addEventListener("blur", () => window.setTimeout(close, 160));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (panel.hidden || !rows.length) return;
      event.preventDefault();
      setActive(active + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Escape") {
      if (panel.hidden) return;
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Enter" && !panel.hidden && active >= 0 && rows[active]) {
      event.preventDefault();
      window.location.assign(rows[active].href);
    }
  });
  // clicking a row must not blur the field before the click lands
  panel.addEventListener("mousedown", (event) => event.preventDefault());
  // the Tab conversion changed the value, so the rows are stale (or the panel needs
  // to open: converting か back to "ka" brings suggestions back)
  window.addEventListener("kanji-romaji", schedule);
  window.addEventListener("resize", () => {
    if (!panel.hidden) fitToViewport();
  });
})();
