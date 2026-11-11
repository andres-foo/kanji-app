(() => {
  const dataNode = document.getElementById("shot-viewer-data");
  const form = document.getElementById("shot-edit-form");
  if (!dataNode || !form) return;

  let data = {};
  try { data = JSON.parse(dataNode.textContent || "{}"); } catch { return; }
  const id = Number(data.id);
  const back = String(data.back || "/screenshot");
  const editButton = document.getElementById("shot-viewer-edit");
  const deleteButton = document.getElementById("shot-viewer-delete");
  const saveButton = document.getElementById("shot-edit-save");
  const cancelButton = document.getElementById("shot-edit-cancel");
  const jp = document.getElementById("shot-edit-jp");
  const en = document.getElementById("shot-edit-en");
  const position = document.getElementById("shot-edit-position");
  const overlay = document.getElementById("shot-viewer-overlay");
  const overlayJp = document.getElementById("shot-viewer-jp");
  const overlayEn = document.getElementById("shot-viewer-en");
  const error = document.getElementById("shot-edit-error");
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

  const openEditor = () => {
    if (!jp || !en || !position) return;
    jp.value = saved.japanese;
    en.value = saved.english;
    position.value = String(saved.position);
    form.hidden = false;
    showError("");
    renderOverlay();
    jp.focus();
  };

  const closeEditor = () => {
    form.hidden = true;
    showError("");
    if (jp) jp.value = saved.japanese;
    if (en) en.value = saved.english;
    if (position) position.value = String(saved.position);
    renderOverlay();
  };

  editButton?.addEventListener("click", openEditor);
  cancelButton?.addEventListener("click", closeEditor);
  [jp, en, position].forEach((control) => control?.addEventListener("input", renderOverlay));
  [position].forEach((control) => control?.addEventListener("change", renderOverlay));

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
      saved = {
        japanese,
        english: en?.value.trim() ?? "",
        position: Number(position?.value) === 1 ? 1 : 0,
      };
      closeEditor();
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

  if (new URLSearchParams(location.search).get("edit") === "1") openEditor();
})();
