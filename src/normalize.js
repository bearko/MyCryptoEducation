/* 表記ゆれの吸収 ------------------------------------------------------
   半角カナ→全角、全角英数→半角、カタカナ→ひらがな、記号除去。
   ビルド時に生成された受理集合と照合する。LLMは使わない。          */

const HALF = "｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";
const FULL = "。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン";

export function toFullWidthKana(s) {
  return s
    .replace(/[\uFF61-\uFF9F]ﾞ/g, c => {
      const i = HALF.indexOf(c[0]);
      return i < 0 ? c : String.fromCharCode(FULL.charCodeAt(i) + 1);
    })
    .replace(/[\uFF61-\uFF9F]ﾟ/g, c => {
      const i = HALF.indexOf(c[0]);
      return i < 0 ? c : String.fromCharCode(FULL.charCodeAt(i) + 2);
    })
    .replace(/[\uFF61-\uFF9F]/g, c => {
      const i = HALF.indexOf(c);
      return i < 0 ? c : FULL[i];
    });
}

export function katakanaToHiragana(s) {
  return s.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function hiraganaToKatakana(s) {
  return s.replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

export function normalize(s) {
  return katakanaToHiragana(toFullWidthKana(String(s || "").trim()))
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
    .replace(/[\s\u3000・･、。,.\-ー―–—'’"”「」()（）!！?？]/g, "");
}

export function matches(input, acceptList) {
  const n = normalize(input);
  return n.length > 0 && acceptList.some(a => normalize(a) === n);
}
