(() => {
  const dataNode = document.getElementById("shot-viewer-data");
  const form = document.getElementById("shot-edit-form");
  if (!dataNode || !form) return;

  let data = {};
  try { data = JSON.parse(dataNode.textContent || "{}"); } catch { return; }
  const id = Number(data.id);
  const back = String(data.back || "/screenshot");
  const deleteButton = document.getElementById("shot-viewer-delete");
  const saveButton = document.getElementById("shot-edit-save");
  const cancelButton = document.getElementById("shot-edit-cancel");
  const jp = document.getElementById("shot-edit-jp");
  const en = document.getElementById("shot-edit-en");
  const position = document.getElementById("shot-edit-position");
  const overlay = document.getElementById("shot-viewer-overlay");
  const overlayJp = document.getElementById("shot-viewer-jp");
  const overlayEn = document.getElementById("shot-viewer-en");
  const summary = document.getElementById("shot-viewer-summary");
  const error = document.getElementById("shot-edit-error");
  const savedToast = document.getElementById("shot-viewer-saved");
  let savedTimer = 0;
  let saved = {
    japanese: overlayJp?.textContent || "",
    english: overlayEn?.textContent || "",
    position: Number(position?.value) === 1 ? 1 : 0,
  };

  const showError = (message) => {
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
  };

  const showSaved = () => {
    if (!savedToast) return;
    savedToast.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { savedToast.hidden = true; }, 4000);
  };

  const hideSaved = () => {
    clearTimeout(savedTimer);
    if (savedToast) savedToast.hidden = true;
  };

  const renderOverlay = () => {
    if (!overlay || !overlayJp || !overlayEn) return;
    const text = jp?.value ?? saved.japanese;
    const english = en?.value ?? saved.english;
    const top = Number(position?.value) === 1;
    overlay.className = `shot-viewer-overlay ${top ? "top" : "bottom"}`;
    overlay.hidden = !text.trim();
    overlayJp.textContent = text;
    overlayEn.textContent = english;
    overlayEn.hidden = !english.trim();
  };

  // Put the fields back to the last saved values (Cancel, or after a save).
  const applySaved = () => {
    if (jp) jp.value = saved.japanese;
    if (en) en.value = saved.english;
    if (position) position.value = String(saved.position);
    renderOverlay();
    showError("");
  };

  cancelButton?.addEventListener("click", () => {
    applySaved();
    hideSaved();
  });
  [jp, en, position].forEach((control) => control?.addEventListener("input", () => {
    hideSaved();
    renderOverlay();
  }));
  position?.addEventListener("change", renderOverlay);

  saveButton?.addEventListener("click", async () => {
    const japanese = jp?.value.trim() ?? "";
    if (!japanese) { showError("Japanese is required."); return; }
    saveButton.disabled = true;
    showError("");
    try {
      const response = await fetch(`/screenshot/${id}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          japanese,
          english: en?.value.trim() ?? "",
          position: Number(position?.value) === 1 ? 1 : 0,
        }),
      });
      const result = await response.json();
      if (!response.ok || result.ok === false) {
        showError(result.error === "japanese required" ? "Japanese is required." : "Could not save changes.");
        return;
      }
      // Stay on this screen: keep the editor open and confirm with a toast.
      saved = {
        japanese,
        english: en?.value.trim() ?? "",
        position: Number(position?.value) === 1 ? 1 : 0,
      };
      applySaved();
      if (summary) summary.textContent = saved.japanese || "No Japanese text";
      showSaved();
    } catch {
      showError("Could not save changes.");
    } finally {
      saveButton.disabled = false;
    }
  });

  deleteButton?.addEventListener("click", async () => {
    if (!confirm("Delete this screenshot and its image?")) return;
    deleteButton.disabled = true;
    try {
      const response = await fetch(`/screenshot/${id}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok || result.ok === false) {
        showError("Could not delete the screenshot.");
        deleteButton.disabled = false;
        return;
      }
      window.location.href = back;
    } catch {
      showError("Could not delete the screenshot.");
      deleteButton.disabled = false;
    }
  });

  renderOverlay();
})();
