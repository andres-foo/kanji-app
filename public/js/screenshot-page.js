(() => {
  const queue = document.getElementById("shot-queue");
  if (!queue) return;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const statusDot = $("#shot-ocr-line .shot-ocr-dot");
  const statusText = $("#shot-ocr-text");
  const recheck = $("#shot-ocr-recheck");
  const autofillEmpty = $("#autofill-empty");
  const saveAll = $("#save-all");
  const counter = $("#shot-counter");
  const counterN = $("#shot-counter-n");
  let ocrState = "checking";

  const cards = () => $$(".shot-card", queue);
  const jp = (card) => $(".shot-jp", card);
  const en = (card) => $(".shot-en", card);

  const showError = (card, message) => {
    const box = $(".shot-error", card);
    if (!box) return;
    box.textContent = message;
    box.hidden = !message;
  };

  const setBusy = (card, busy) => {
    $$("button", card).forEach((button) => { button.disabled = busy || (button.hasAttribute("data-shot-autofill") && ocrState !== "ready"); });
  };

  const updateBadges = (card) => {
    const noJp = $(".shot-no-jp", card);
    const noEn = $(".shot-no-en", card);
    if (noJp) noJp.hidden = !!jp(card)?.value.trim();
    if (noEn) noEn.hidden = !!en(card)?.value.trim();
  };

  const updateAutofill = () => {
    const empty = cards().filter((card) => !jp(card)?.value.trim()).length;
    autofillEmpty.textContent = `Autofill ${empty} empty`;
    autofillEmpty.disabled = ocrState !== "ready" || empty === 0;
    saveAll.disabled = !cards().some((card) => !!jp(card)?.value.trim());
  };

  const setStatus = (state, model = "") => {
    ocrState = state;
    if (!statusDot || !statusText) return;
    statusDot.className = `shot-ocr-dot ${state}`;
    statusText.textContent = state === "ready"
      ? `OCR ready${model ? ` · ${model}` : ""}`
      : state === "loading" ? "OCR model loading…" : state === "offline" ? "OCR service offline" : "Checking OCR…";
    $$("[data-shot-autofill]").forEach((button) => { button.disabled = state !== "ready"; });
    updateAutofill();
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

  const updateCounter = (delta) => {
    if (!counter) return;
    const next = Math.max(0, Number(counter.dataset.count || 0) + delta);
    counter.dataset.count = String(next);
    if (!next) counter.remove();
    else if (counterN) counterN.textContent = String(next);
  };

  const syncEmpty = () => {
    if (cards().length) return;
    if ($(".listempty", queue)) return;
    queue.innerHTML = `<div class="card listempty"><h2>No pending screenshots</h2><p class="sub">Upload one above.</p></div>`;
    updateAutofill();
  };

  const removeCard = (card, delta = 1) => {
    card.remove();
    updateCounter(-delta);
    syncEmpty();
    updateAutofill();
  };

  const autofillCard = async (card, force = false) => {
    const field = jp(card);
    if (!field) return false;
    // An empty visible field may still have a stored value from a previous
    // autofill, so force OCR instead of letting the server skip it.
    force = force || !field.value.trim();
    if (field.value.trim() && !force) {
      if (!confirm("Replace the Japanese text with the OCR result?")) return false;
      force = true;
    }
    setBusy(card, true);
    showError(card, "");
    try {
      const result = await postJson(`/screenshot/${card.dataset.id}/autofill`, { force });
      if (!result.ok) {
        if (result.data.error === "offline") setStatus("offline");
        showError(card, result.data.error === "offline" ? "OCR service is offline." : "Autofill failed.");
        return false;
      }
      if (typeof result.data.text === "string" && !result.data.skipped) field.value = result.data.text;
      updateBadges(card);
      updateAutofill();
      return true;
    } catch {
      showError(card, "Autofill failed.");
      return false;
    } finally {
      setBusy(card, false);
    }
  };

  const saveCard = async (card, remove = true) => {
    const japanese = jp(card)?.value.trim() ?? "";
    if (!japanese) { showError(card, "Japanese is required."); return false; }
    setBusy(card, true);
    showError(card, "");
    try {
      const result = await postJson(`/screenshot/${card.dataset.id}/save`, {
        japanese,
        english: en(card)?.value.trim() ?? "",
        position: Number($(".shot-position-select", card)?.value) === 1 ? 1 : 0,
      });
      if (!result.ok) { showError(card, result.data.error === "japanese required" ? "Japanese is required." : "Save failed."); return false; }
      const done = $(".shot-done", card);
      if (done) done.classList.add("show");
      card.dataset.done = "1";
      window.setTimeout(() => { if (remove && card.isConnected) removeCard(card); }, 500);
      return true;
    } catch {
      showError(card, "Save failed.");
      return false;
    } finally {
      setBusy(card, false);
    }
  };

  const deleteCard = async (card) => {
    if (!confirm("Delete this screenshot?")) return;
    setBusy(card, true);
    showError(card, "");
    try {
      const result = await postJson(`/screenshot/${card.dataset.id}/delete`);
      if (!result.ok) { showError(card, "Delete failed."); return; }
      removeCard(card);
    } catch {
      showError(card, "Delete failed.");
    } finally {
      if (card.isConnected) setBusy(card, false);
    }
  };

  // Large split editor for comparing the image and its transcription.
  let editModal = null;
  let editCards = [];
  let editIndex = -1;
  let editCard = null;
  let editInitial = null;

  const modalValues = () => ({
    japanese: $("#shot-modal-jp")?.value ?? "",
    english: $("#shot-modal-en")?.value ?? "",
    position: Number($("#shot-modal-position")?.value) === 1 ? 1 : 0,
  });

  const modalDirty = () => {
    if (!editInitial) return false;
    const now = modalValues();
    return now.japanese !== editInitial.japanese ||
      now.english !== editInitial.english ||
      now.position !== editInitial.position;
  };

  const modalError = (message) => {
    const box = $("#shot-modal-error");
    if (!box) return;
    box.textContent = message;
    box.hidden = !message;
  };

  const loadModal = (card, index) => {
    editCard = card;
    editIndex = index;
    editInitial = {
      japanese: jp(card)?.value ?? "",
      english: en(card)?.value ?? "",
      position: Number($(".shot-position-select", card)?.value) === 1 ? 1 : 0,
    };
    $("#shot-modal-jp").value = editInitial.japanese;
    $("#shot-modal-en").value = editInitial.english;
    $("#shot-modal-position").value = String(editInitial.position);
    const image = $("#shot-modal-image");
    image.src = `/shot/${card.dataset.id}?v=${encodeURIComponent(card.dataset.hash || "")}`;
    image.alt = `Screenshot ${index + 1}`;
    $("#shot-modal-count").textContent = `${index + 1} / ${editCards.length}`;
    modalError("");
  };

  const buildModal = () => {
    const root = document.createElement("div");
    root.className = "shot-modal";
    root.innerHTML = `<div class="shot-modal-card" role="dialog" aria-modal="true" aria-label="Edit screenshot">
      <div class="shot-modal-head"><div><h2>Edit screenshot</h2><span class="sub" id="shot-modal-count"></span></div><button type="button" class="shot-modal-close" aria-label="Close">×</button></div>
      <div class="shot-modal-body">
        <div class="shot-modal-preview"><img id="shot-modal-image" alt=""></div>
        <div class="shot-modal-fields">
          <label class="shot-label">Japanese<textarea id="shot-modal-jp" rows="5" spellcheck="false"></textarea></label>
          <label class="shot-label">English<textarea id="shot-modal-en" rows="3" spellcheck="false"></textarea></label>
          <label class="shot-position">Show text<select id="shot-modal-position" class="shot-position-select"><option value="0">At the bottom</option><option value="1">At the top</option></select></label>
          <div class="shot-error" id="shot-modal-error" role="alert" hidden></div>
          <div class="shot-modal-actions">
            <button class="pill ghost sm" type="button" id="shot-modal-autofill"${ocrState === "ready" ? "" : " disabled"}>Autofill</button>
            <button class="pill dark sm" type="button" id="shot-modal-save">Save</button>
            <button class="pill ghost rem sm" type="button" id="shot-modal-delete">Delete</button>
          </div>
        </div>
      </div>
      <div class="shot-modal-nav"><button class="pill ghost sm" type="button" id="shot-modal-prev">← Previous</button><button class="pill ghost sm" type="button" id="shot-modal-next">Next →</button></div>
    </div>`;
    root.addEventListener("click", (event) => { if (event.target === root) closeModal(); });
    root.querySelector(".shot-modal-close").addEventListener("click", () => closeModal());
    root.querySelector("#shot-modal-prev").addEventListener("click", () => moveModal(-1));
    root.querySelector("#shot-modal-next").addEventListener("click", () => moveModal(1));
    root.querySelector("#shot-modal-autofill").addEventListener("click", autofillModal);
    root.querySelector("#shot-modal-save").addEventListener("click", saveModal);
    root.querySelector("#shot-modal-delete").addEventListener("click", deleteModal);
    document.addEventListener("keydown", modalKey);
    document.body.append(root);
    document.body.classList.add("shot-modal-open");
    return root;
  };

  const openModal = (card) => {
    editCards = cards();
    const index = editCards.indexOf(card);
    if (index < 0) return;
    editModal = buildModal();
    loadModal(card, index);
    $("#shot-modal-jp")?.focus();
  };

  const closeModal = (force = false) => {
    if (!editModal) return;
    if (!force && modalDirty() && !confirm("Discard unsaved changes?")) return;
    document.removeEventListener("keydown", modalKey);
    editModal.remove();
    document.body.classList.remove("shot-modal-open");
    editModal = null;
    editCard = null;
    editInitial = null;
  };

  const moveModal = (delta) => {
    if (!editModal || !editCards.length) return;
    if (modalDirty() && !confirm("Discard unsaved changes?")) return;
    editIndex = (editIndex + delta + editCards.length) % editCards.length;
    loadModal(editCards[editIndex], editIndex);
  };

  function modalKey(event) {
    if (event.key === "Escape") { event.preventDefault(); closeModal(); }
  }

  async function autofillModal() {
    if (!editCard) return;
    const field = $("#shot-modal-jp");
    if (!field) return;
    let force = !field.value.trim();
    if (field.value.trim() && !confirm("Replace the Japanese text with the OCR result?")) return;
    force = true;
    $("#shot-modal-autofill").disabled = true;
    modalError("");
    try {
      const result = await postJson(`/screenshot/${editCard.dataset.id}/autofill`, { force });
      if (!result.ok) {
        if (result.data.error === "offline") setStatus("offline");
        modalError(result.data.error === "offline" ? "OCR service is offline." : "Autofill failed.");
        return;
      }
      if (typeof result.data.text === "string" && !result.data.skipped) field.value = result.data.text;
    } catch {
      modalError("Autofill failed.");
    } finally {
      $("#shot-modal-autofill").disabled = ocrState !== "ready";
    }
  }

  async function saveModal() {
    if (!editCard) return;
    const values = modalValues();
    if (!values.japanese.trim()) { modalError("Japanese is required."); return; }
    $("#shot-modal-save").disabled = true;
    modalError("");
    try {
      const result = await postJson(`/screenshot/${editCard.dataset.id}/save`, {
        japanese: values.japanese.trim(),
        english: values.english.trim(),
        position: values.position,
      });
      if (!result.ok) {
        modalError(result.data.error === "japanese required" ? "Japanese is required." : "Save failed.");
        return;
      }
      if (jp(editCard)) jp(editCard).value = values.japanese.trim();
      if (en(editCard)) en(editCard).value = values.english.trim();
      const select = $(".shot-position-select", editCard);
      if (select) select.value = String(values.position);
      const card = editCard;
      closeModal(true);
      removeCard(card);
    } catch {
      modalError("Save failed.");
    } finally {
      if ($("#shot-modal-save")) $("#shot-modal-save").disabled = false;
    }
  }

  async function deleteModal() {
    if (!editCard || !confirm("Delete this screenshot?")) return;
    $("#shot-modal-delete").disabled = true;
    modalError("");
    try {
      const result = await postJson(`/screenshot/${editCard.dataset.id}/delete`);
      if (!result.ok) { modalError("Delete failed."); return; }
      const card = editCard;
      closeModal(true);
      removeCard(card);
    } catch {
      modalError("Delete failed.");
    } finally {
      if ($("#shot-modal-delete")) $("#shot-modal-delete").disabled = false;
    }
  }

  queue.addEventListener("input", (event) => {
    if (!event.target.matches(".shot-jp, .shot-en")) return;
    const card = event.target.closest(".shot-card");
    if (card) updateBadges(card);
    updateAutofill();
  });

  queue.addEventListener("click", (event) => {
    const card = event.target.closest(".shot-card");
    if (!card) return;
    if (event.target.closest("[data-shot-edit]")) openModal(card);
    else if (event.target.closest("[data-shot-autofill]")) void autofillCard(card);
    else if (event.target.closest("[data-shot-save]")) void saveCard(card);
    else if (event.target.closest("[data-shot-delete]")) void deleteCard(card);
  });

  autofillEmpty.addEventListener("click", async () => {
    const targets = cards().filter((card) => !jp(card)?.value.trim());
    autofillEmpty.disabled = true;
    for (const card of targets) {
      if (ocrState !== "ready") break;
      await autofillCard(card);
    }
    updateAutofill();
  });

  saveAll.addEventListener("click", async () => {
    const targets = cards().filter((card) => !!jp(card)?.value.trim());
    saveAll.disabled = true;
    for (const card of targets) await saveCard(card);
    updateAutofill();
  });

  recheck?.addEventListener("click", () => void checkStatus());

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
    selected.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      const item = document.createElement("div");
      item.className = "shot-selected-item";
      const image = document.createElement("img");
      image.src = url;
      image.alt = file.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.addEventListener("click", () => { selected.splice(index, 1); renderSelected(); });
      item.append(image, remove);
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

  cards().forEach(updateBadges);
  updateAutofill();
  void checkStatus();
})();
