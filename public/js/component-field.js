// Component keyword suggestions inside the kanji edit form.
(() => {
  const input = document.getElementById("component-field");
  const box = document.getElementById("component-field-suggestions");
  if (!input || !box) return;

  let timer = 0;
  let controller = null;
  let active = -1;

  const buttons = () => [...box.querySelectorAll(".component-suggestion")];

  const hide = () => {
    box.hidden = true;
    box.innerHTML = "";
    active = -1;
  };

  const tokenAtCaret = () => {
    const value = input.value;
    const caret = input.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const start = before.lastIndexOf(";") + 1;
    const query = before.slice(start);
    if (!/^[a-z]+$/i.test(query) || query.length < 3) return null;
    const after = value.slice(caret);
    const endSemi = after.indexOf(";");
    const end = endSemi >= 0 ? caret + endSemi : value.length;
    return { start, end, query };
  };

  const setActive = (index) => {
    const list = buttons();
    if (!list.length) { active = -1; return; }
    active = (index + list.length) % list.length;
    list.forEach((button, i) => button.classList.toggle("active", i === active));
    list[active].scrollIntoView({ block: "nearest" });
  };

  const replaceWith = (button) => {
    const token = tokenAtCaret();
    if (!token || active < 0) return;
    const literal = button.dataset.literal || "";
    if (!literal) return;
    input.value = input.value.slice(0, token.start) + literal + input.value.slice(token.end);
    const caret = token.start + literal.length;
    input.setSelectionRange(caret, caret);
    hide();
    input.focus();
  };

  const search = async (query, otherComponents) => {
    if (controller) controller.abort();
    controller = new AbortController();
    const params = new URLSearchParams({ q: query });
    if (otherComponents) params.set("components", otherComponents);
    try {
      const response = await fetch(`/components/search/suggest?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      box.innerHTML = await response.text();
      box.hidden = false;
      active = -1;
      if (buttons().length) setActive(0);
    } catch (error) {
      if (error.name !== "AbortError") hide();
    }
  };

  const update = () => {
    window.clearTimeout(timer);
    const token = tokenAtCaret();
    if (!token) { hide(); return; }
    const existing = input.value.split(";")
      .map((part) => part.trim())
      .filter((part) => part && !/^[a-z]+$/i.test(part))
      .join(",");
    timer = window.setTimeout(() => search(token.query, existing), 120);
  };

  input.addEventListener("input", update);
  input.addEventListener("click", update);
  input.addEventListener("keydown", (event) => {
    const list = buttons();
    if (!list.length) return;
    if (event.key === "Enter") {
      event.preventDefault();
      replaceWith(list[active >= 0 ? active : 0]);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(active + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); hide(); }
  });

  box.addEventListener("mousedown", (event) => event.preventDefault());
  box.addEventListener("click", (event) => {
    const button = event.target.closest(".component-suggestion");
    if (button) replaceWith(button);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".component-field")) hide();
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => { if (!box.matches(":hover")) hide(); }, 150);
  });
})();
