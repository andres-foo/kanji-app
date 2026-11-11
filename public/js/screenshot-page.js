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

  queue.addEventListener("input", (event) => {
    if (!event.target.matches(".shot-jp, .shot-en")) return;
    const card = event.target.closest(".shot-card");
    if (card) updateBadges(card);
    updateAutofill();
  });

  queue.addEventListener("click", (event) => {
    const card = event.target.closest(".shot-card");
    if (!card) return;
    if (event.target.closest("[data-shot-autofill]")) void autofillCard(card);
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

  const imageToJpeg = async (file) => {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
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
