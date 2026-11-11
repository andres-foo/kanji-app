(() => {
  const dataNode = document.getElementById("shot-carousel-data");
  if (!dataNode) return;
  let items = [];
  try { items = JSON.parse(dataNode.textContent || "[]"); } catch { return; }
  if (!Array.isArray(items) || !items.length) return;

  let modal = null;
  let current = 0;
  let opener = null;

  const build = () => {
    const root = document.createElement("div");
    root.className = "shot-carousel";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Screenshots");
    root.innerHTML = `<div class="shot-carousel-stage">
      <button type="button" class="shot-carousel-close" aria-label="Close">×</button>
      <button type="button" class="shot-carousel-nav prev" aria-label="Previous screenshot">‹</button>
      <div class="shot-carousel-image-wrap">
        <img class="shot-carousel-image" alt="">
        <div class="shot-carousel-text"><div class="shot-carousel-jp"></div><div class="shot-carousel-en"></div></div>
      </div>
      <button type="button" class="shot-carousel-nav next" aria-label="Next screenshot">›</button>
      <div class="shot-carousel-foot"><div class="shot-carousel-count" aria-live="polite"></div><a class="shot-carousel-edit" href="#" target="_blank" rel="noopener noreferrer">Edit</a></div>
      <div class="shot-carousel-thumbs"></div>
    </div>`;
    document.body.append(root);
    root.addEventListener("click", (event) => {
      if (event.target === root) close();
    });
    root.querySelector(".shot-carousel-close").addEventListener("click", close);
    root.querySelector(".prev").addEventListener("click", () => move(-1));
    root.querySelector(".next").addEventListener("click", () => move(1));
    return root;
  };

  const render = () => {
    if (!modal) return;
    const item = items[current];
    const image = modal.querySelector(".shot-carousel-image");
    image.src = `/shot/${item.id}`;
    image.alt = item.japanese || `Screenshot #${item.id}`;
    const text = modal.querySelector(".shot-carousel-text");
    text.className = `shot-carousel-text ${item.position === 1 ? "top" : "bottom"}`;
    modal.querySelector(".shot-carousel-jp").textContent = item.japanese || "";
    const en = modal.querySelector(".shot-carousel-en");
    en.textContent = item.english || "";
    en.hidden = !item.english;
    modal.querySelector(".shot-carousel-count").textContent = `${current + 1} / ${items.length}`;
    const edit = modal.querySelector(".shot-carousel-edit");
    if (edit) edit.href = `/shot/${item.id}/view?edit=1&back=${encodeURIComponent(location.pathname + location.search)}`;

    const strip = modal.querySelector(".shot-carousel-thumbs");
    strip.innerHTML = "";
    items.forEach((entry, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `shot-carousel-thumb${index === current ? " active" : ""}`;
      button.setAttribute("aria-label", `Screenshot ${index + 1}`);
      const thumb = document.createElement("img");
      thumb.src = `/shot/${entry.id}/thumb`;
      thumb.alt = "";
      thumb.loading = "lazy";
      button.append(thumb);
      button.addEventListener("click", () => { current = index; render(); });
      strip.append(button);
    });

    for (const offset of [-1, 1]) {
      const neighbor = items[current + offset];
      if (neighbor) {
        const preload = new Image();
        preload.src = `/shot/${neighbor.id}`;
      }
    }
  };

  const move = (delta) => {
    if (!items.length) return;
    current = (current + delta + items.length) % items.length;
    render();
  };

  const close = () => {
    if (!modal) return;
    modal.remove();
    modal = null;
    document.body.classList.remove("shot-carousel-open");
    document.removeEventListener("keydown", onKey);
    if (opener) opener.focus();
  };

  const open = (index, source) => {
    opener = source || null;
    current = Number.isInteger(index) ? Math.max(0, Math.min(items.length - 1, index)) : 0;
    if (!modal) {
      modal = build();
      document.body.classList.add("shot-carousel-open");
      document.addEventListener("keydown", onKey);
    }
    render();
    modal.querySelector(".shot-carousel-close")?.focus();
  };

  function onKey(event) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); return; }
    if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
  }

  document.querySelectorAll("[data-shot-id]").forEach((card) => {
    card.addEventListener("click", (event) => {
      event.preventDefault();
      const id = Number(card.dataset.shotId);
      const index = items.findIndex((item) => Number(item.id) === id);
      if (index >= 0) open(index, card);
    });
  });

  document.querySelector("[data-carousel-all]")?.addEventListener("click", (event) => {
    event.preventDefault();
    open(6, event.currentTarget);
  });
})();
