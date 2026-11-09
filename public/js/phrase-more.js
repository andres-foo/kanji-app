const button = document.querySelector("[data-phrase-more]");
const list = document.getElementById("phrase-list");
const count = document.getElementById("phrase-count");

if (button && list) {
  button.addEventListener("click", async () => {
    const literal = button.dataset.literal || "";
    const offset = Number(button.dataset.offset) || 0;
    const batch = Number(button.dataset.batch) || 5;
    const total = Number(button.dataset.total) || 0;
    button.disabled = true;
    try {
      const response = await fetch(`/kanji/${encodeURIComponent(literal)}/phrases?offset=${offset}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      list.insertAdjacentHTML("beforeend", data.html || "");
      const shown = Number(data.shown) || 0;
      const remaining = Number(data.remaining) || 0;
      const allTotal = Number(data.total) || total;
      const shownTotal = offset + shown;
      button.dataset.offset = String(shownTotal);
      if (count) count.textContent = remaining ? `${shownTotal} of ${allTotal}` : String(allTotal);
      if (remaining <= 0) {
        button.parentElement.innerHTML = `<span class="sub">All ${allTotal} phrases shown.</span>`;
      } else {
        button.textContent = remaining > batch ? `Show ${batch} more` : `Show last ${remaining}`;
        button.disabled = false;
      }
    } catch {
      button.disabled = false;
    }
  });
}
