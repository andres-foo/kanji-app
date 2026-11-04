// Search query rules shared by the router and the layout.
export const SEARCH_MIN = 2;
const singleCjk = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u;
export const shortQuery = (q: string) => [...q].length < SEARCH_MIN && !singleCjk.test(q);
