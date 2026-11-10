// Tab in the main search bar toggles between romaji and hiragana.
(() => {
const KANA = {};
`a あ i い u う e え o お ka か ki き ku く ke け ko こ sa さ shi し si し su す se せ so そ
ta た chi ち ti ち tsu つ tu つ te て to と na な ni に nu ぬ ne ね no の ha は hi ひ fu ふ hu ふ he へ ho ほ
ma ま mi み mu む me め mo も ya や yu ゆ yo よ ra ら ri り ru る re れ ro ろ wa わ wo を
ga が gi ぎ gu ぐ ge げ go ご za ざ ji じ zi じ zu ず ze ぜ zo ぞ da だ di ぢ du づ de で do ど
ba ば bi び bu ぶ be べ bo ぼ pa ぱ pi ぴ pu ぷ pe ぺ po ぽ
kya きゃ kyu きゅ kyo きょ sha しゃ shu しゅ sho しょ sya しゃ syu しゅ syo しょ
cha ちゃ chu ちゅ cho ちょ cya ちゃ cyu ちゅ cyo ちょ tya ちゃ tyu ちゅ tyo ちょ
nya にゃ nyu にゅ nyo にょ hya ひゃ hyu ひゅ hyo ひょ mya みゃ myu みゅ myo みょ
rya りゃ ryu りゅ ryo りょ gya ぎゃ gyu ぎゅ gyo ぎょ ja じゃ ju じゅ jo じょ
jya じゃ jyu じゅ jyo じょ zya じゃ zyu じゅ zyo じょ dya ぢゃ dyu ぢゅ dyo ぢょ
bya びゃ byu びゅ byo びょ pya ぴゃ pyu ぴゅ pyo ぴょ fa ふぁ fi ふぃ fe ふぇ fo ふぉ je じぇ che ちぇ she しぇ`
  .split(/\s+/).forEach((token, i, all) => { if (i % 2 === 0) KANA[token] = all[i + 1]; });

const ROMAJI = {};
for (const [romaji, kana] of Object.entries(KANA)) {
  if (!ROMAJI[kana]) ROMAJI[kana] = romaji;
}
ROMAJI["ん"] = "n";

function romajiToHiragana(value) {
  const source = value.toLowerCase().replace(/\s+/g, "");
  if (!/^[a-z']+$/.test(source) || !/[a-z]/.test(source)) return null;
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "n" && next === "'") { out += "ん"; i += 2; continue; }
    if (c === "'") { i++; continue; }
    if (next === c && /[bcdfghjkmpqrstvwxyz]/.test(c)) { out += "っ"; i++; continue; }
    if (c === "t" && next === "c" && source[i + 2] === "h") { out += "っ"; i++; continue; }
    let hit = false;
    for (let len = 3; len >= 1 && !hit; len--) {
      const kana = KANA[source.slice(i, i + len)];
      if (kana && source.length >= i + len) { out += kana; i += len; hit = true; }
    }
    if (hit) continue;
    if (c === "n" && (next === undefined || !/[aiueoy]/.test(next))) { out += "ん"; i++; continue; }
    if (c === "m" && (next === "b" || next === "p")) { out += "ん"; i++; continue; }
    return null;
  }
  return out;
}

function hiraganaToRomaji(value) {
  const source = value.trim();
  if (!/^[\u3041-\u3096ー]+$/.test(source)) return null;
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (source[i] === "っ") {
      let next = null;
      let nextLength = 0;
      for (let len = 3; len >= 1; len--) {
        const romaji = ROMAJI[source.slice(i + 1, i + 1 + len)];
        if (romaji && source.length >= i + 1 + len) { next = romaji; nextLength = len; break; }
      }
      if (!next) return null;
      out += next[0] + next;
      i += 1 + nextLength;
      continue;
    }
    if (source[i] === "ー") {
      const last = out.match(/[aeiou]$/);
      if (!last) return null;
      out += last[0];
      i++;
      continue;
    }
    let hit = false;
    for (let len = 3; len >= 1; len--) {
      const romaji = ROMAJI[source.slice(i, i + len)];
      if (romaji && source.length >= i + len) { out += romaji; i += len; hit = true; break; }
    }
    if (!hit) return null;
  }
  return out;
}

const input = document.querySelector('.navsearch input[name="q"]');
const hint = document.getElementById("search-romaji-hint");
if (input) {
  let converted = null;

  const caretToEnd = () => {
    const end = input.value.length;
    input.setSelectionRange(end, end);
  };

  const hideHint = () => {
    if (!hint) return;
    hint.hidden = true;
    hint.textContent = "";
  };

  const updateHint = () => {
    if (!hint) return;
    let target = "";
    if (converted && input.value === converted.to) target = converted.from;
    else {
      const hiragana = romajiToHiragana(input.value.trim());
      if (hiragana && hiragana !== input.value) target = hiragana;
      else {
        const romaji = hiraganaToRomaji(input.value);
        if (romaji && romaji !== input.value) target = romaji;
      }
    }
    if (!target) {
      hideHint();
      return;
    }
    hint.innerHTML = `<span class="tab-key"><span class="tab-icon" aria-hidden="true">⇥</span><span>Tab</span></span><span class="tab-arrow">→</span><span class="tab-target"></span>`;
    const targetEl = hint.querySelector(".tab-target");
    if (targetEl) targetEl.textContent = target;
    hint.hidden = false;
  };

  input.addEventListener("focus", updateHint);
  input.addEventListener("blur", hideHint);
  input.form?.addEventListener("submit", hideHint);
  input.addEventListener("input", () => { converted = null; updateHint(); });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.shiftKey) return;
    if (converted && input.value === converted.to) {
      event.preventDefault();
      const from = converted.from;
      const to = converted.to;
      input.value = from;
      converted = { from: to, to: from };
      caretToEnd();
      updateHint();
      return;
    }
    const from = input.value;
    const hiragana = romajiToHiragana(from.trim());
    const romaji = hiragana ? "" : hiraganaToRomaji(from);
    const to = hiragana || romaji;
    if (to && to !== from) {
      event.preventDefault();
      input.value = to;
      converted = { from, to };
      caretToEnd();
      updateHint();
    }
  });

  if (document.activeElement === input) updateHint();
}
})();