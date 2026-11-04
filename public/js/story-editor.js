
(function () {
  var form = document.getElementById("editform");
  if (!form) return;
  var ta = form.querySelector('textarea[name="story"]');
  var ed = document.getElementById("storyed");
  var tools = document.getElementById("storytools");
  var modeBtn = document.getElementById("storymode");
  if (!ta || !ed || !tools || !modeBtn) return;

  var CLASS = { "=": "story_keyword", "_": "story_component", "?": "story_note", "#": "story_link" };
  var MARK = { story_keyword: "=", story_component: "_", story_note: "?", story_link: "#" };
  var PATTERN = /=([^=\n]+)=|_([^_\n]+)_|\?([^?\n]+)\?|#([^#\n]+)#/g;
  var ZWSP = /\u200B/g;
  var mode = "rich"; // "rich" = formatted editor, "code" = the raw markup textarea

  // markup -> formatted DOM (keywords, components and notes may nest, exactly like storyHtml)
  function textInto(frag, value) {
    var parts = String(value).split("\n");
    for (var i = 0; i < parts.length; i++) {
      if (i) frag.appendChild(document.createElement("br"));
      if (parts[i]) frag.appendChild(document.createTextNode(parts[i]));
    }
  }
  function fragmentFor(value) {
    var frag = document.createDocumentFragment();
    var re = new RegExp(PATTERN.source, "g");
    var last = 0;
    var m;
    while ((m = re.exec(value))) {
      textInto(frag, value.slice(last, m.index));
      var span = document.createElement("span");
      if (m[4] === undefined) {
        span.className = m[1] !== undefined ? CLASS["="] : m[2] !== undefined ? CLASS["_"] : CLASS["?"];
        span.appendChild(fragmentFor(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]));
      } else {
        span.className = CLASS["#"];
        span.textContent = m[4];
      }
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    textInto(frag, value.slice(last));
    return frag;
  }
  function render(code) {
    ed.textContent = "";
    ed.appendChild(fragmentFor(code));
  }

  // formatted DOM -> markup: line breaks become newlines and every formatted span becomes its marker pair
  function serialize(node) {
    var out = "";
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c.nodeType === 3) { out += c.nodeValue.replace(ZWSP, ""); continue; }
      if (c.nodeType !== 1) continue;
      if (c.nodeName === "BR") { out += "\n"; continue; }
      var mark = "";
      for (var k in MARK) if (c.classList && c.classList.contains(k)) { mark = MARK[k]; break; }
      var inner = serialize(c);
      if (mark && inner) { out += mark + inner + mark; continue; }
      if (c.nodeName === "DIV" || c.nodeName === "P") {
        out += (out && out.charAt(out.length - 1) !== "\n" ? "\n" : "") + inner;
        continue;
      }
      out += inner;
    }
    return out;
  }

  // the textarea stays the form field; every edit in the formatted view writes the markup into it
  function sync() { ta.value = serialize(ed); }
  ed.addEventListener("input", sync);

  // the formatted span around the caret, if any, so pressing the same button again removes the formatting
  function spanAround(cls) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var node = sel.getRangeAt(0).commonAncestorContainer;
    while (node && node !== ed) {
      if (node.nodeType === 1 && node.classList && node.classList.contains(cls)) return node;
      node = node.parentNode;
    }
    return null;
  }
  function unwrap(span) {
    var parent = span.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
    var r = document.createRange();
    r.selectNodeContents(parent);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    sync();
  }
  function applyRich(mark) {
    var cls = CLASS[mark];
    var existing = spanAround(cls);
    if (existing) { unwrap(existing); ed.focus(); return; }
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!ed.contains(range.commonAncestorContainer)) return;
    var span = document.createElement("span");
    span.className = cls;
    try {
      if (range.collapsed) {
        // nothing selected: leave an empty marked spot with the caret in it, ready to type into
        span.appendChild(document.createTextNode("\u200B"));
        range.insertNode(span);
        var r1 = document.createRange();
        r1.setStart(span.firstChild, 0);
        r1.setEnd(span.firstChild, 1);
        sel.removeAllRanges();
        sel.addRange(r1);
      } else {
        span.appendChild(range.extractContents());
        range.insertNode(span);
        var r2 = document.createRange();
        r2.selectNodeContents(span);
        sel.removeAllRanges();
        sel.addRange(r2);
      }
    } catch (e) {
      return;
    }
    ed.focus();
    sync();
  }
  // in code mode the same buttons wrap the textarea selection with the markers instead
  function applyCode(mark) {
    var s = ta.selectionStart;
    var e = ta.selectionEnd;
    var v = ta.value;
    if (s === e) {
      ta.value = v.slice(0, s) + mark + mark + v.slice(e);
      ta.selectionStart = ta.selectionEnd = s + 1;
    } else {
      ta.value = v.slice(0, s) + mark + v.slice(s, e) + mark + v.slice(e);
      ta.selectionStart = s + 1;
      ta.selectionEnd = e + 1;
    }
    ta.focus();
  }
  function apply(mark) { if (mode === "rich") applyRich(mark); else applyCode(mark); }

  // pasted content is always plain text, so markup from another app never sneaks into the story
  ed.addEventListener("paste", function (e) {
    var data = e.clipboardData || window.clipboardData;
    var text = data && data.getData ? data.getData("text/plain") : "";
    if (!text) return;
    e.preventDefault();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    sync();
  });

  function setMode(next) {
    mode = next;
    var rich = mode === "rich";
    if (rich) {
      render(ta.value);
      ed.hidden = false;
      ta.hidden = true;
      ed.focus();
    } else {
      sync();
      ed.hidden = true;
      ta.hidden = false;
      ta.focus();
    }
    modeBtn.textContent = rich ? "Show code" : "Show preview";
    modeBtn.setAttribute("aria-pressed", rich ? "false" : "true");
  }

  tools.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-mark]");
    if (btn) { e.preventDefault(); apply(btn.getAttribute("data-mark")); return; }
    if (modeBtn.contains(e.target)) { e.preventDefault(); setMode(mode === "rich" ? "code" : "rich"); }
  });
  // keep the caret and the selected text in the story when a toolbar button is pressed
  tools.addEventListener("mousedown", function (e) {
    if (e.target.closest("button")) e.preventDefault();
  });
  form.addEventListener("submit", function () { if (mode === "rich") sync(); });

  // progressive enhancement: without JavaScript the field is just the code textarea.
  // Build the formatted view first; if that ever fails, keep the plain textarea so the story cannot be lost.
  try {
    render(ta.value);
  } catch (e) {
    return;
  }
  tools.hidden = false;
  ed.hidden = false;
  ta.hidden = true;
})();
