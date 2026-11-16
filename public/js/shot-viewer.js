(() => {
  const dataNode = document.getElementById("shot-viewer-data");
  const form = document.getElementById("shot-edit-form");
  if (!dataNode || !form) return;

  let data = {};
  try { data = JSON.parse(dataNode.textContent || "{}"); } catch { return; }
  const id = Number(data.id);
  const back = String(data.back || "/screenshot");
  const configured = data.configured === true;
  const deleteButton = document.getElementById("shot-viewer-delete");
  const saveButton = document.getElementById("shot-edit-save");
  const cancelButton = document.getElementById("shot-edit-cancel");
  const translateButton = document.getElementById("shot-edit-translate");
  const autofillButton = document.getElementById("shot-edit-autofill");
  const analyzeButton = document.getElementById("shot-edit-analyze");
  const jp = document.getElementById("shot-edit-jp");
  const en = document.getElementById("shot-edit-en");
  const position = document.getElementById("shot-edit-position");
  const overlay = document.getElementById("shot-viewer-overlay");
  const overlayJp = document.getElementById("shot-viewer-jp");
  const overlayEn = document.getElementById("shot-viewer-en");
  const summary = document.getElementById("shot-viewer-summary");
  const analysisSection = document.getElementById("shot-viewer-analysis");
  const analysisBody = document.getElementById("shot-viewer-analysis-body");
  const error = document.getElementById("shot-edit-error");
  const savedToast = document.getElementById("shot-viewer-saved");
  let savedTimer = 0;
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

  let saved = {
    japanese: typeof data.japanese === "string" ? data.japanese : overlayJp?.textContent || "",
    english: overlayEn?.textContent || "",
    furigana: typeof data.japanese_furigana === "string" ? data.japanese_furigana : "",
    position: Number(position?.value) === 1 ? 1 : 0,
  };

  const showError = (message) => {
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
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

  const showSaved = () => {
    if (!savedToast) return;
    savedToast.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { savedToast.hidden = true; }, 4000);
  };

  // Position is metadata, so it saves on change instead of waiting for Save.
  let positionSave = Promise.resolve();
  const savePosition = () => {
    if (!position) return;
    const value = Number(position.value) === 1 ? 1 : 0;
    if (value === saved.position) return;
    positionSave = positionSave.then(async () => {
      const response = await fetch(`/screenshot/${id}/position`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: value }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        showError("Could not save the text position.");
        return;
      }
      saved.position = value;
    }).catch(() => showError("Could not save the text position."));
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
    // An edited sentence no longer matches the imported reading, so only the
    // unchanged one keeps its ruby.
    renderFurigana(overlayJp, text.trim(), text.trim() === saved.japanese.trim() ? saved.furigana : "");
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

  translateButton?.addEventListener("click", async () => {
    const text = jp?.value.trim() ?? "";
    if (!text) { showError("Add Japanese text first."); return; }
    if ((en?.value.trim() ?? "") && !confirm("Replace the English text with the translation?")) return;
    translateButton.disabled = true;
    showError("");
    const done = busyLabel(translateButton, "Translating…");
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const result = await response.json();
      if (!response.ok || result.ok === false || typeof result.text !== "string") {
        showError((result.ai === true && aiError(result.error)) || "Translation failed. Check that this machine can reach Google.");
        return;
      }
      if (en) en.value = result.text;
      renderOverlay();
    } catch {
      showError("Translation failed. Check that this machine can reach Google.");
    } finally {
      done();
      translateButton.disabled = false;
    }
  });

  autofillButton?.addEventListener("click", async () => {
    if (!configured) { showError("Add an API key in Settings to use Autofill."); return; }
    if ((jp?.value.trim() ?? "") && !confirm("Replace the Japanese text with the OCR result?")) return;
    autofillButton.disabled = true;
    showError("");
    const done = busyLabel(autofillButton, "Autofilling…");
    try {
      const response = await fetch(`/screenshot/${id}/autofill`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        showError(aiError(result.error) || "Autofill failed.");
        return;
      }
      const japanese = typeof result.japanese === "string" ? result.japanese : "";
      const english = typeof result.english === "string" ? result.english : "";
      // The route persisted both values; keep the local "saved" snapshot in
      // step with it so Cancel restores what the database actually holds.
      saved.japanese = japanese;
      saved.english = english;
      saved.furigana = "";
      if (jp) jp.value = japanese;
      if (en && !en.value.trim() && english) en.value = english;
      if (summary) summary.textContent = japanese || "No Japanese text";
      hideSaved();
      renderOverlay();
      if (!japanese && !english) showError("No text was recognized in the screenshot.");
    } catch {
      showError("Autofill failed.");
    } finally {
      done();
      autofillButton.disabled = !configured;
    }
  });

  analyzeButton?.addEventListener("click", async () => {
    if (!configured) { showError("Add an API key in Settings to use Analyze."); return; }
    if (!saved.japanese.trim()) {
      showError(jp?.value.trim() ? "Save the Japanese text first, then analyze." : "Add Japanese text first.");
      return;
    }
    analyzeButton.disabled = true;
    showError("");
    const done = busyLabel(analyzeButton, "Analyzing…");
    try {
      const response = await fetch(`/screenshot/${id}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        showError(aiError(result.error) || "Analysis failed.");
        return;
      }
      const html = typeof result.analysis_html === "string" ? result.analysis_html : "";
      if (!html || !analysisSection || !analysisBody) {
        showError("The analysis came back empty.");
        return;
      }
      // Escaped and rendered server-side by markdown.ts.
      analysisBody.innerHTML = html;
      analysisSection.hidden = false;
      analysisSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch {
      showError("Analysis failed.");
    } finally {
      done();
      analyzeButton.disabled = !configured;
    }
  });

  [jp, en, position].forEach((control) => control?.addEventListener("input", () => {
    hideSaved();
    renderOverlay();
  }));
  position?.addEventListener("change", () => {
    renderOverlay();
    void savePosition();
  });

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
        furigana: typeof result.row?.japanese_furigana === "string" ? result.row.japanese_furigana : "",
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
