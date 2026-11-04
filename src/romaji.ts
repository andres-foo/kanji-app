// Hepburn/Kunrei romaji -> hiragana, used by the search suggestions.
const KANA: Record<string, string> = {};
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
  .split(/\s+/).forEach((t, i, a) => { if (i % 2 === 0) KANA[t] = a[i + 1]; });

/** Hepburn/Kunrei romaji to hiragana. Returns null unless the WHOLE text converts cleanly. */
export function romajiToHiragana(input: string): string | null {
  const s = input.toLowerCase().replace(/\s+/g, "");
  if (!/^[a-z']+$/.test(s) || !/[a-z]/.test(s)) return null;
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i], next = s[i + 1];
    if (c === "n" && next === "'") { out += "ん"; i += 2; continue; }
    if (c === "'") { i++; continue; }
    if (next === c && /[bcdfghjkmpqrstvwxyz]/.test(c)) { out += "っ"; i++; continue; }
    if (c === "t" && next === "c" && s[i + 2] === "h") { out += "っ"; i++; continue; }
    let hit = false;
    for (let len = 3; len >= 1 && !hit; len--) {
      const k = KANA[s.slice(i, i + len)];
      if (k && s.length >= i + len) { out += k; i += len; hit = true; }
    }
    if (hit) continue;
    if (c === "n" && (next === undefined || !/[aiueoy]/.test(next))) { out += "ん"; i++; continue; }
    if (c === "m" && (next === "b" || next === "p")) { out += "ん"; i++; continue; }
    return null;
  }
  return out;
}
