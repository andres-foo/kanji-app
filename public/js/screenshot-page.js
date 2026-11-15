(() => {
  const editor = document.getElementById("shot-editor");
  const dataNode = document.getElementById("shot-editor-data");
  const emptyCard = document.getElementById("shot-empty");
  if (!editor || !dataNode || !emptyCard) return;

  const $ = (sel, root = document) => root.querySelector(sel);
  const statusDot = $("#shot-ocr-line .shot-ocr-dot");
  const statusText = $("#shot-ocr-text");
  const recheck = $("#shot-ocr-recheck");
  const counter = $("#shot-counter");
  const counterN = $("#shot-counter-n");
  const jp = $("#shot-editor-jp");
  const en = $("#shot-editor-en");
  const position = $("#shot-editor-position");
  const image = $("#shot-editor-image");
  const preview = $("#shot-editor-preview");
  const overlay = $("#shot-editor-overlay");
  const overlayJp = $("#shot-editor-overlay-jp");
  const overlayEn = $("#shot-editor-overlay-en");
  const countLabel = $("#shot-editor-count");
  const addedLabel = $("#shot-editor-added");
  const sourceBadge = $("#shot-editor-source");
  const errorBox = $("#shot-editor-error");
  const autofillButton = $("#shot-editor-autofill");
  const translateButton = $("#shot-editor-translate");
  const saveButton = $("#shot-editor-save");
  const deleteButton = $("#shot-editor-delete");
  const prevButton = $("#shot-editor-prev");
  const nextButton = $("#shot-editor-next");

  let items = [];
  try {
    const parsed = JSON.parse(dataNode.textContent || "[]");
    if (Array.isArray(parsed)) items = parsed;
  } catch { /* keep the empty queue */ }
  let index = 0;
  let ocrState = "checking";
  let busy = false;

  const values = () => ({
    japanese: jp.value,
    english: en.value,
    position: Number(position.value) === 1 ? 1 : 0,
  });

  const dirty = () => {
    const item = items[index];
    if (!item) return false;
    const now = values();
    return now.japanese !== item.japanese ||
      now.english !== item.english ||
      now.position !== item.position;
  };

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  };

  // Mirror the saved output live: the same Japanese/English block the viewer
  // and carousel draw over the image, at the edge chosen in the dropdown.
  const syncOverlay = () => {
    const japanese = jp.value.trim();
    const english = en.value.trim();
    const top = Number(position.value) === 1;
    overlayJp.textContent = japanese;
    overlayEn.textContent = english;
    overlayJp.hidden = !japanese;
    overlayEn.hidden = !english;
    overlay.hidden = !japanese;
    overlay.classList.toggle("top", top);
    overlay.classList.toggle("bottom", !top);
    placeOverlay();
  };

  // Line the text block up with the rendered image instead of the letterbox
  // around it, so the preview matches what the viewer will show.
  const placeOverlay = () => {
    const box = preview.getBoundingClientRect();
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const top = Number(position.value) === 1;
    overlay.style.left = `${rect.left - box.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.right = "auto";
    overlay.style.top = top ? `${rect.top - box.top}px` : "auto";
    overlay.style.bottom = top ? "auto" : `${box.bottom - rect.bottom}px`;
  };

  // Keep every control in sync with the current item, navigation and OCR
  // state; a single place means busy/empty states can't re-enable buttons.
  const refreshButtons = () => {
    const hasItem = Boolean(items[index]);
    const canMove = !busy && items.length > 1;
    prevButton.disabled = !canMove;
    nextButton.disabled = !canMove;
    saveButton.disabled = busy || !hasItem;
    deleteButton.disabled = busy || !hasItem;
    translateButton.disabled = busy || !hasItem;
    autofillButton.disabled = busy || !hasItem || ocrState !== "ready";
  };

  const setBusy = (value) => {
    busy = value;
    refreshButtons();
  };

  const updateCounter = (delta) => {
    if (!counter) return;
    const next = Math.max(0, Number(counter.dataset.count || 0) + delta);
    counter.dataset.count = String(next);
    if (!next) counter.remove();
    else if (counterN) counterN.textContent = String(next);
  };

  const render = () => {
    const item = items[index];
    if (!item) return;
    jp.value = item.japanese;
    en.value = item.english;
    position.value = String(item.position === 1 ? 1 : 0);
    image.src = `/shot/${item.id}?v=${encodeURIComponent(item.hash || "")}`;
    image.alt = `Screenshot #${item.id}`;
    countLabel.textContent = `${index + 1} / ${items.length}`;
    if (addedLabel) addedLabel.textContent = item.added_at ? `Added ${item.added_at}` : "";
    if (sourceBadge) sourceBadge.hidden = item.source !== "import";
    showError("");
    syncOverlay();
    refreshButtons();
  };

  const showEmpty = () => {
    editor.hidden = true;
    emptyCard.hidden = false;
    refreshButtons();
  };

  const removeCurrent = () => {
    items.splice(index, 1);
    updateCounter(-1);
    if (!items.length) { showEmpty(); return; }
    // Stay on the nearest remaining row instead of jumping to the newest one
    // when the last row of the set is saved or deleted.
    if (index >= items.length) index = items.length - 1;
    render();
  };

  const move = (delta) => {
    if (items.length < 2) return;
    if (dirty() && !confirm("Discard unsaved changes?")) return;
    index = (index + delta + items.length) % items.length;
    render();
  };

  const postJson = async (url, body = {}) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await response.json(); } catch { /* keep the status code */ }
    return { ok: response.ok && data.ok !== false, data };
  };

  const translate = async () => {
    const item = items[index];
    if (!item) return;
    const text = jp.value.trim();
    if (!text) { showError("Add Japanese text first."); return; }
    if (en.value.trim() && !confirm("Replace the English text with the translation?")) return;
    setBusy(true);
    showError("");
    try {
      const result = await postJson("/api/translate", { text });
      if (!result.ok || typeof result.data.text !== "string") {
        showError("Translation failed. Check that this machine can reach Google.");
        return;
      }
      // Leave item.english untouched so an unsaved translation still counts
      // as a change when navigating away.
      en.value = result.data.text;
      syncOverlay();
    } catch {
      showError("Translation failed. Check that this machine can reach Google.");
    } finally {
      setBusy(false);
    }
  };

  const autofill = async () => {
    const item = items[index];
    if (!item) return;
    if (jp.value.trim() && !confirm("Replace the Japanese text with the OCR result?")) return;
    setBusy(true);
    showError("");
    try {
      // An empty visible field may still have a stored value from a previous
      // autofill, so force OCR instead of letting the server skip it.
      const result = await postJson(`/screenshot/${item.id}/autofill`, { force: true });
      if (!result.ok) {
        if (result.data.error === "offline") setStatus("offline");
        showError(result.data.error === "offline" ? "OCR service is offline." : "Autofill failed.");
        return;
      }
      if (typeof result.data.text === "string" && !result.data.skipped) {
        jp.value = result.data.text;
        item.japanese = result.data.text;
        syncOverlay();
      }
    } catch {
      showError("Autofill failed.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const item = items[index];
    if (!item) return;
    const now = values();
    if (!now.japanese.trim()) { showError("Japanese is required."); return; }
    setBusy(true);
    showError("");
    try {
      const result = await postJson(`/screenshot/${item.id}/save`, {
        japanese: now.japanese.trim(),
        english: now.english.trim(),
        position: now.position,
      });
      if (!result.ok) {
        showError(result.data.error === "japanese required" ? "Japanese is required." : "Save failed.");
        return;
      }
      removeCurrent();
    } catch {
      showError("Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const item = items[index];
    if (!item || !confirm("Delete this screenshot?")) return;
    setBusy(true);
    showError("");
    try {
      const result = await postJson(`/screenshot/${item.id}/delete`);
      if (!result.ok) { showError("Delete failed."); return; }
      removeCurrent();
    } catch {
      showError("Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (state, model = "") => {
    ocrState = state;
    if (statusDot && statusText) {
      statusDot.className = `shot-ocr-dot ${state}`;
      statusText.textContent = state === "ready"
        ? `OCR ready${model ? ` · ${model}` : ""}`
        : state === "loading" ? "OCR model loading…" : state === "offline" ? "OCR service offline" : "Checking OCR…";
    }
    refreshButtons();
  };

  const checkStatus = async () => {
    setStatus("checking");
    if (recheck) recheck.disabled = true;
    try {
      const response = await fetch("/api/ocr", { headers: { accept: "application/json" } });
      const data = await response.json();
      setStatus(data.state ?? "offline", data.model ?? "");
    } catch {
      setStatus("offline");
    } finally {
      if (recheck) recheck.disabled = false;
    }
  };

  saveButton.addEventListener("click", () => void save());
  deleteButton.addEventListener("click", () => void remove());
  autofillButton.addEventListener("click", () => void autofill());
  translateButton.addEventListener("click", () => void translate());
  prevButton.addEventListener("click", () => move(-1));
  nextButton.addEventListener("click", () => move(1));
  jp.addEventListener("input", syncOverlay);
  en.addEventListener("input", syncOverlay);
  position.addEventListener("change", syncOverlay);
  image.addEventListener("load", placeOverlay);
  window.addEventListener("resize", placeOverlay);
  recheck?.addEventListener("click", () => void checkStatus());

  if (items.length) render();
  else showEmpty();
  void checkStatus();

  // Uploader: convert each selected image to a JPEG at its original resolution.
  const fileInput = $("#shot-file-input");
  const drop = $("#shot-drop");
  const selectedBox = $("#shot-selected");
  const uploadButton = $("#shot-upload");
  const progress = $("#shot-progress");
  let selected = [];
  let objectUrls = [];

  const setProgress = (text) => { if (progress) progress.textContent = text; };

  const renderSelected = () => {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
    if (!selectedBox) return;
    selectedBox.innerHTML = "";
    selected.forEach((file, i) => {
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      const item = document.createElement("div");
      item.className = "shot-selected-item";
      const thumbnail = document.createElement("img");
      thumbnail.src = url;
      thumbnail.alt = file.name;
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `Remove ${file.name}`);
      removeButton.addEventListener("click", () => { selected.splice(i, 1); renderSelected(); });
      item.append(thumbnail, removeButton);
      selectedBox.append(item);
    });
    if (uploadButton) uploadButton.disabled = selected.length === 0;
    setProgress(selected.length ? `${selected.length} / 5 selected` : "");
  };

  const addFiles = (files) => {
    const valid = [...files].filter((file) => /^image\/(png|jpeg)$/.test(file.type));
    const combined = [...selected, ...valid];
    if (combined.length > 5) setProgress("Only 5 images can be selected; extras were skipped.");
    selected = combined.slice(0, 5);
    if (!valid.length && files.length) setProgress("Choose PNG or JPEG images.");
    renderSelected();
  };

  fileInput?.addEventListener("change", () => {
    addFiles(fileInput.files ?? []);
    fileInput.value = "";
  });
  drop?.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("dragover"); });
  drop?.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop?.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("dragover");
    addFiles(event.dataTransfer?.files ?? []);
  });

  const imageToJpeg = async (file, maxWidth) => {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = maxWidth ? Math.min(1, maxWidth / bitmap.width) : 1;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", maxWidth ? 0.76 : 0.9));
      if (!blob) throw new Error("Could not convert image");
      return blob;
    } finally {
      bitmap.close?.();
    }
  };

  uploadButton?.addEventListener("click", async () => {
    if (!selected.length) return;
    uploadButton.disabled = true;
    try {
      const form = new FormData();
      for (let i = 0; i < selected.length; i++) {
        setProgress(`Converting ${i + 1} / ${selected.length}…`);
        form.append("files", await imageToJpeg(selected[i]), `screenshot-${i + 1}.jpg`);
        form.append("thumbs", await imageToJpeg(selected[i], 320), `screenshot-${i + 1}-thumb.jpg`);
      }
      setProgress(`Uploading ${selected.length}…`);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/screenshot/upload");
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) setProgress(`Uploading ${Math.round(event.loaded / event.total * 100)}%`);
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 400) {
          window.location.href = xhr.responseURL || "/screenshot";
        } else {
          setProgress("Upload failed.");
          uploadButton.disabled = false;
        }
      });
      xhr.addEventListener("error", () => { setProgress("Upload failed."); uploadButton.disabled = false; });
      xhr.send(form);
    } catch {
      setProgress("Could not convert one of the images.");
      uploadButton.disabled = false;
    }
  });
})();
