import { db } from "../db";
import { enc, esc } from "../html";
import { findImage } from "../images";
import type { Kanji } from "../types";
import { meaningsText } from "./shared";

export async function kanjiRedesignEditView(literal: string, q = "") {
  const k = db.query(`SELECT * FROM kanjis WHERE literal = ?`).get(literal) as Kanji | null;
  if (!k) return null;

  const img = await findImage(k.literal);
  const added = k.added === 1;
  const unfinished = k.unfinished === 1;
  const viewHref = `/kanji/${enc(k.literal)}${q ? `?q=${enc(q)}` : ""}`;
  const editHref = `${viewHref}${q ? "&" : "?"}edit=1`;

  const field = (name: string, label: string, value: string | null) =>
    `<label class="efield"><span>${label}</span><input type="text" name="${name}" value="${esc(value)}" autocomplete="off"></label>`;
  const componentField = `<div class="efield component-field">
<span>Components</span>
<input id="component-field" type="text" name="components" value="${esc(k.components)}" autocomplete="off">
<div id="component-field-suggestions" class="component-field-suggestions" role="listbox" hidden></div>
</div>`;
  const check = (name: string, label: string, on: boolean) =>
    `<label class="echeck"><input type="checkbox" name="${name}" value="1"${on ? " checked" : ""}><span>${label}</span></label>`;

  // the script (public/js/story-editor.js) enhances this into the formatted editor;
  // without JavaScript the textarea is the story field
  const storyField = `<div class="storyfield">
<span class="flab" id="storylab">Story</span>
<div class="storytools" id="storytools" role="toolbar" aria-label="Story formatting" hidden>
<button type="button" class="tool" data-mark="=" title="Keyword: =text=">= Keyword</button>
<button type="button" class="tool" data-mark="_" title="Component: _text_">_ Component</button>
<button type="button" class="tool" data-mark="?" title="Note: ?text?">? Note</button>
<button type="button" class="tool" data-mark="#" title="Link: #text#"># Link</button>
<span class="sp"></span>
<button type="button" class="tool" id="storymode" aria-pressed="false">Show code</button>
</div>
<div class="storyed" id="storyed" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="storylab" hidden></div>
<textarea name="story" id="storycode" aria-label="Story">${esc(k.story)}</textarea>
</div>`;

  const body = `
<div class="edithead">
  <div>
    <div class="crumb">Kanji / ${esc(k.literal)}</div>
    <h1>Edit <span style="font-family:'Noto Serif JP',Jigmo,serif;vertical-align:-3px">${esc(k.literal)}</span></h1>
    <div class="sub">${esc(meaningsText(k.meanings))}</div>
  </div>
</div>

<div class="grid">
  <div class="card eimgcard" style="grid-column:span 4">
    <div class="eimg">${img ? `<img src="/img/${enc(k.literal)}" alt="${esc(k.literal)}">` : `<div class="noimg">No image yet</div>`}</div>
    <div class="sub" style="margin-top:8px">${added ? (unfinished ? "Unfinished" : "In your study list") : "Not added"}</div>
    <div class="picbtns">
      <form method="post" action="/kanji/${enc(k.literal)}/image" enctype="multipart/form-data">
        <input type="hidden" name="back" value="${esc(editHref)}">
        <label class="pill ghost sm picbtn">Upload<input type="file" name="image" accept="image/jpeg,image/png" aria-label="Upload an image for ${esc(k.literal)}" onchange="this.form.requestSubmit()"></label>
      </form>
      ${img ? `<form method="post" action="/kanji/${enc(k.literal)}/image/delete" data-msg="Remove the image for ${esc(k.literal)}?" onsubmit="return confirm(this.dataset.msg)">
        <input type="hidden" name="back" value="${esc(editHref)}">
        <button class="pill ghost sm" type="submit">Remove</button>
      </form>` : ""}
    </div>
  </div>

  <form class="card eform" id="editform" style="grid-column:span 8" method="post" action="/kanji/${enc(k.literal)}/edit">
    <input type="hidden" name="back" value="${esc(viewHref)}">
    <div class="efields">
      ${field("keyword", "Keyword", k.keyword)}
      ${componentField}
      ${field("related", "Related", k.related)}
    </div>
    <div class="echecks">${check("added", "Added", added)}${check("unfinished", "Unfinished", unfinished)}${check("is_component", "Is component", k.is_component === 1)}</div>
    ${storyField}
  </form>
</div>
<div class="editfoot">
  <a class="pill ghost" href="${viewHref}">Cancel</a>
  <button class="pill dark" type="submit" form="editform">Save</button>
</div>
<script src="/js/story-editor.js" defer></script>
<script src="/js/component-field.js" defer></script>`;

  return { title: `Edit ${k.literal} — Kanji`, body };
}
