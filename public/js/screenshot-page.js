(() => {
  const editor = document.getElementById("shot-editor");
  const dataNode = document.getElementById("shot-editor-data");
  const emptyCard = document.getElementById("shot-empty");
  if (!editor || !dataNode || !emptyCard) return;

  const $ = (sel, root = document) => root.querySelector(sel);
  const furiganaPattern = () => /([\u3400-\u4DBF\u4E00-\u9FFF\u3005\u3041-\u3096\u30A1-\u30FA\u30FC]+)《([\u3041-\u3096\u30A1-\u30FA\u30FC]+)》/g;
  const KANJI_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\u3005]/;
  const KANA_CHAR = /[\u3041-\u3096\u30A1-\u30FA\u30FC]/;

  // The annotated word can include okurigana (心して《こころして》); split the
  // shared trailing kana so ruby sits over the kanji part.
  const furiganaParts = (run, reading) => {
    const firstKanji = run.search(KANJI_CHAR);
    if (firstKanji < 0) return null;
    const context = run.slice(0, firstKanji);
    const word = run.slice(firstKanji);
    let yomi = reading;
    for (let length = context.length; length > 0; length--) {
      const prefix = context.slice(context.length - length);
      if (yomi.startsWith(prefix)) {
        yomi = yomi.slice(prefix.length);
        break;
      }
    }
    let cut = 0;
    while (
      cut < word.length &&
      cut < yomi.length &&
      KANA_CHAR.test(word[word.length - 1 - cut]) &&
      word[word.length - 1 - cut] === yomi[yomi.length - 1 - cut]
    ) {
      cut++;
    }
    const base = word.slice(0, word.length - cut);
    const after = word.slice(word.length - cut);
    const ruby = yomi.slice(0, yomi.length - cut);
    if (!base || !KANJI_CHAR.test(base) || !ruby) return null;
    return { context, base, reading: ruby, after };
  };

  // Ruby is generated from the annotated string, but every other character is
  // only ever a text node. A malformed annotation falls back to plain text.
  const renderFurigana = (element, japanese, furigana) => {
    element.textContent = japanese;
    if (!furigana) return;
    const matches = [...furigana.matchAll(furiganaPattern())];
    if (!matches.length) return;
    let last = 0;
    const fragment = document.createDocumentFragment();
    for (const match of matches) {
      if (/[《》]/.test(furigana.slice(last, match.index))) return;
      const parts = furiganaParts(match[1], match[2]);
      if (!parts) return;
      fragment.append(furigana.slice(last, match.index));
      fragment.append(parts.context);
      const ruby = document.createElement("ruby");
      ruby.textContent = parts.base;
      const rt = document.createElement("rt");
      rt.textContent = parts.reading;
      ruby.append(rt);
      fragment.append(ruby);
      fragment.append(parts.after);
      last = (match.index ?? 0) + match[0].length;
    }
    if (/[《》]/.test(furigana.slice(last))) return;
    fragment.append(furigana.slice(last));
    element.replaceChildren(fragment);
  };
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
  const aiReady = editor.dataset.aiConfigured === "1";
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

  const busyLabel = (button, label) => {
    if (!button) return () => {};
    const original = button.textContent;
    button.textContent = label;
    button.setAttribute("aria-busy", "true");
    return () => {
      button.textContent = original;
      button.removeAttribute("aria-busy");
    };
  };

  const aiError = (code) => {
    switch (code) {
      case "disabled": return "No API key is configured. Add one in Settings.";
      case "unauthorized": return "API key was rejected — check Settings";
      case "rate-limited": return "Rate limited — try again shortly";
      case "timeout": return "The AI request timed out";
      case "offline": return "The AI provider is unreachable — check the connection and base URL";
      case "bad-response": return "The AI provider returned an unexpected response — check the base URL and model";
      case "no-text": return "Add Japanese text first.";
      case "forbidden": return "Request rejected. Reload the page and try again.";
      default: return "";
    }
  };

  // Mirror the saved output live: the same Japanese/English block the viewer
  // and carousel draw over the image, at the edge chosen in the dropdown.
  const syncOverlay = () => {
    const japanese = jp.value.trim();
    const english = en.value.trim();
    const top = Number(position.value) === 1;
    const item = items[index];
    // Once the Japanese field is edited the imported reading no longer
    // describes it, so the preview goes back to plain text.
    const furigana = item && japanese === item.japanese.trim() ? item.japanese_furigana : "";
    renderFurigana(overlayJp, japanese, furigana);
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

  // Keep every control in sync with the current item, navigation and AI
  // state; a single place means busy/empty states can't re-enable buttons.
  const refreshButtons = () => {
    const hasItem = Boolean(items[index]);
    const canMove = !busy && items.length > 1;
    prevButton.disabled = !canMove;
    nextButton.disabled = !canMove;
    saveButton.disabled = busy || !hasItem;
    deleteButton.disabled = busy || !hasItem;
    if (translateButton) translateButton.disabled = busy || !hasItem;
    if (autofillButton) autofillButton.disabled = busy || !hasItem || !aiReady;
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

  // Position is metadata, so it saves on change instead of waiting for Save.
  // Changes are chained so a quick back-and-forth cannot land out of order.
  let positionSave = Promise.resolve();
  const savePosition = () => {
    const item = items[index];
    if (!item) return;
    const value = Number(position.value) === 1 ? 1 : 0;
    if (value === item.position) return;
    positionSave = positionSave.then(async () => {
      const result = await postJson(`/screenshot/${item.id}/position`, { position: value });
      if (!result.ok) {
        if (items[index] === item) showError("Could not save the text position.");
        return;
      }
      item.position = value;
    }).catch(() => {
      if (items[index] === item) showError("Could not save the text position.");
    });
  };

  const translate = async () => {
    const item = items[index];
    if (!item) return;
    const text = jp.value.trim();
    if (!text) { showError("Add Japanese text first."); return; }
    if (en.value.trim() && !confirm("Replace the English text with the translation?")) return;
    setBusy(true);
    showError("");
    const done = busyLabel(translateButton, "Translating…");
    try {
      const result = await postJson("/api/translate", { text });
      if (!result.ok || typeof result.data.text !== "string") {
        showError((result.data.ai === true && aiError(result.data.error)) || "Translation failed. Check that this machine can reach Google.");
        return;
      }
      // Leave item.english untouched so an unsaved translation still counts
      // as a change when navigating away.
      en.value = result.data.text;
      syncOverlay();
    } catch {
      showError("Translation failed. Check that this machine can reach Google.");
    } finally {
      done();
      setBusy(false);
    }
  };

  const autofill = async () => {
    const item = items[index];
    if (!item) return;
    if (jp.value.trim() && !confirm("Replace the Japanese text with the OCR result?")) return;
    setBusy(true);
    showError("");
    const done = busyLabel(autofillButton, "Autofilling…");
    try {
      // An empty visible field may still have a stored value from a previous
      // autofill, so force the provider instead of letting the server skip it.
      const result = await postJson(`/screenshot/${item.id}/autofill`, { force: true });
      if (!result.ok) {
        showError(aiError(result.data.error) || "Autofill failed.");
        return;
      }
      const japanese = typeof result.data.japanese === "string" ? result.data.japanese : "";
      const english = typeof result.data.english === "string" ? result.data.english : "";
      jp.value = japanese;
      item.japanese = japanese;
      item.japanese_furigana = "";
      // Only fill an empty English field; anything typed there wins.
      if (!en.value.trim() && english) en.value = english;
      item.english = english;
      syncOverlay();
      if (!japanese && !english) showError("No text was recognized in the screenshot.");
    } catch {
      showError("Autofill failed.");
    } finally {
      done();
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

  saveButton.addEventListener("click", () => void save());
  deleteButton.addEventListener("click", () => void remove());
  autofillButton?.addEventListener("click", () => void autofill());
  translateButton?.addEventListener("click", () => void translate());
  prevButton.addEventListener("click", () => move(-1));
  nextButton.addEventListener("click", () => move(1));
  jp.addEventListener("input", syncOverlay);
  en.addEventListener("input", syncOverlay);
  position.addEventListener("change", () => {
    syncOverlay();
    void savePosition();
  });
  image.addEventListener("load", placeOverlay);
  window.addEventListener("resize", placeOverlay);

  if (items.length) render();
  else showEmpty();

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
