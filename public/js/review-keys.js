
(function () {
  if (!window.matchMedia || !window.matchMedia("(pointer: fine)").matches || window.matchMedia("(hover: none)").matches) return;
  var bar = document.querySelector(".reviewbar");
  if (!bar) return;
  document.body.classList.add("keys");

  var reveal = bar.querySelector('a.reviewbtn[href*="review=1"]');
  var NAMES = ["bad", "neutral", "good", "easy"];
  var KEYS = { a: "bad", s: "neutral", d: "good", f: "easy" };
  var PAD = { 6: "bad", 4: "neutral", 5: "good", 7: "easy" }; // LT, LB, RB, RT
  var REVEAL_BUTTON = 1; // A
  var forms = {};
  Array.prototype.forEach.call(bar.querySelectorAll("form"), function (f) {
    var action = f.getAttribute("action") || "";
    var name = action.slice(action.lastIndexOf("/") + 1);
    if (NAMES.indexOf(name) >= 0) forms[name] = f;
  });
  var busy = false;

  function setInput(kind) {
    document.documentElement.dataset.input = kind;
    try { localStorage.setItem("kanji_input", kind); } catch (e) {}
  }

  function showAnswer() {
    if (!reveal || busy) return;
    busy = true;
    reveal.click();
  }

  function answer(result) {
    var form = forms[result];
    if (!form || busy) return;
    busy = true;
    // light up the chosen answer for a moment before the page changes, so the press can be checked
    var button = form.querySelector("button");
    if (button) button.classList.add("pressed");
    Array.prototype.forEach.call(bar.querySelectorAll("button"), function (b) { b.disabled = true; });
    setTimeout(function () {
      if (form.requestSubmit) form.requestSubmit();
      else form.submit();
    }, 180);
  }

  document.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt" && e.key !== "Meta") setInput("keyboard");
    if (e.ctrlKey || e.metaKey || e.altKey || busy) return;
    var t = e.target;
    if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
    if (document.querySelector(".lightbox")) return; // a kanji image is enlarged: leave the keys to it
    if (e.code === "Space" || e.key === " ") {
      if (!reveal) return;
      e.preventDefault();
      showAnswer();
      return;
    }
    var result = KEYS[(e.key || "").toLowerCase()];
    if (!result || !forms[result]) return;
    e.preventDefault();
    answer(result);
  });

  // gamepad: poll every frame, act only on a new press (a button held through navigation is ignored)
  var prev = null;
  function held(pad, i) {
    var b = pad.buttons && pad.buttons[i];
    if (!b) return false;
    return i === 6 || i === 7 ? b.value > 0.5 || b.pressed : !!b.pressed;
  }
  function poll() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var pad = null;
    for (var p = 0; p < pads.length; p++) if (pads[p] && pads[p].connected) { pad = pads[p]; break; }
    if (pad) {
      if (!prev) {
        prev = {};
        for (var s = 0; s < pad.buttons.length; s++) prev[s] = held(pad, s);
        // On the question page A can only reveal the answer, and on some browsers the pad only becomes
        // visible on that first press: let it count instead of swallowing it as "already held".
        if (reveal && held(pad, REVEAL_BUTTON)) {
          setInput("pad");
          showAnswer();
        }
      } else {
        for (var b = 0; b < pad.buttons.length; b++) {
          var down = held(pad, b);
          if (down && !prev[b]) {
            setInput("pad");
            if (b === REVEAL_BUTTON) showAnswer();
            else if (PAD[b]) answer(PAD[b]);
          }
          prev[b] = down;
        }
      }
    }
  }
  if (navigator.getGamepads) {
    poll(); // run once straight away: the first press can arrive before the first animation frame
    var loop = function () { poll(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
})();
