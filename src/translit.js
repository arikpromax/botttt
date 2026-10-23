// Транслітерація українською латиницею за офіційними правилами (постанова КМУ № 55 від 27.01.2010) —
// як у закордонному паспорті: «Ярослав» → «Yaroslav», «Згорани» → «Zghorany».

const SIMPLE = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", ж: "zh", з: "z", и: "y", і: "i", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ь: "",
};
// На початку слова — перше, в інших позиціях — друге.
const POSITIONAL = { є: ["ye", "ie"], ї: ["yi", "i"], й: ["y", "i"], ю: ["yu", "iu"], я: ["ya", "ia"] };
const APOSTROPHES = new Set(["'", "’", "ʼ", "`"]);
const isLetter = (ch) => /\p{L}/u.test(ch ?? "");

export const hasCyrillic = (text) => /[а-щьюяґєії]/i.test(text ?? "");

export function transliterate(text) {
  const chars = [...(text ?? "")];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (APOSTROPHES.has(ch) && isLetter(chars[i - 1]) && isLetter(chars[i + 1])) continue; // апостроф пропускаємо
    const lower = ch.toLowerCase();
    let latin;
    if (POSITIONAL[lower]) {
      // Початок слова: перед літерою немає іншої літери (апостроф усередині слова не рахується).
      let j = i - 1;
      while (j >= 0 && APOSTROPHES.has(chars[j])) j--;
      latin = POSITIONAL[lower][isLetter(chars[j]) ? 1 : 0];
    } else if (lower === "г" && chars[i - 1]?.toLowerCase() === "з") {
      latin = "gh"; // «зг» → «zgh», щоб не плутати з «ж»
    } else if (lower in SIMPLE) {
      latin = SIMPLE[lower];
    } else {
      out += ch;
      continue;
    }
    if (ch !== lower && latin) {
      // Велика літера: усе слово великими — усе великими, інакше лише перша.
      const neighbours = [chars[i - 1], chars[i + 1]].filter(isLetter);
      const allCaps = neighbours.length > 0 && neighbours.every((c) => c === c.toUpperCase());
      latin = allCaps ? latin.toUpperCase() : latin[0].toUpperCase() + latin.slice(1);
    }
    out += latin;
  }
  return out;
}
