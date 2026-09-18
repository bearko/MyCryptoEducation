/* コモンズから写真を採るための共通部品。
   `fetch-commons.mjs`（一括取り込み）と `pick-commons.mjs`（選択画面）が
   **両方ここを呼びます。** 2箇所に分けると必ずズレるためです
   （validate と data.js を同じ関数にしてあるのと同じ理由）。

   ここが解こうとしている問題は「検索では狙ったものが来ない」ことです。
   コモンズの検索（srsearch）はファイル解説ページの全文検索なので、投稿者名や
   カテゴリの文言にも当たります。実際に起きたこと：

     dog sitting portrait  → 投稿者名 DogTwo に当たり、カフェにいる人の写真
     chicken egg white     → マヨネーズの皿
     Shakespeare portrait  → ヘンデルの肖像画

   **「Xの写真がほしい」に対して、全文検索はそもそも道具が違います。**
   ウィキデータの P18（画像）とウィキペディアの代表画像は、**人が「これがXの
   代表画像だ」と決めたもの**です。そちらを先に見ます。 */

const UA = "sekai-no-kyoushitsu/0.4 (educational quiz; https://github.com/bearko/MyCryptoEducation)";
const COMMONS  = "https://commons.wikimedia.org/w/api.php";
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const wiki = lang => `https://${lang}.wikipedia.org/w/api.php`;

export const WIDE = 640, SMALL = 360, WAIT = 1200;
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const call = async (base, params) => {
  const url = `${base}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${new URL(base).host} ${res.status}`);
  return res.json();
};

/* ---- ライセンスの見分け ---- */

/**
 * ライセンス名を、`allow` と同じ言い方に寄せる。
 *
 * **コモンズの短縮名は1つに決まっていません。** 同じパブリックドメインでも
 * `PD-old-70`・`PD-US-expired`・`PD-self`・`PD-USGov`・`PDM 1.0` と、根拠ごとに
 * 別の名前が付きます。短縮名をそのまま返していたので、**中身はPDなのに
 * `allow` に無いとして落としていました**（`npm run pick:commons` で候補が
 * 全滅したのがこれです）。ここで言い方をそろえます。
 *
 * **CC BY-SA を先に見ます。** 後ろから見ると CC BY として拾ってしまい、
 * 使ってはいけないものを通します（共有継承が改変物に波及するため）。
 */
const foldLicense = t => {
  const v = String(t || "").trim();
  if (!v) return "";
  if (/^cc[-\s]?by[-\s]?sa/i.test(v)) return v;          // 共有継承。使わない
  if (/^cc[-\s]?by[-\s]?(nc|nd)/i.test(v)) return v;      // 非営利・改変禁止。使わない
  if (/^(pd|public\s*domain|pdm|cc\s*pdm)([-\s.]|$)/i.test(v)) return "Public domain";
  if (/^cc0/i.test(v)) return "CC0";
  const by = v.match(/^cc[-\s]?by[-\s]?([1-4])(?:\.(\d))?/i);
  if (by) return `CC BY ${by[1]}.${by[2] ?? "0"}`;
  return v;
};

export const normalizeLicense = m => {
  const short = foldLicense(m?.LicenseShortName?.value);
  if (short) return short;
  const code = foldLicense((m?.License?.value || "").toLowerCase());
  return code || "不明";
};

/** **出題中に題名を伏せられるライセンスか。** PD と CC0 だけが表示義務を持たない */
export const isTitleFree = lic => /^(public domain|pdm|cc0)/i.test(String(lic || ""));

/**
 * その候補をこの行に使えるか。使えないなら理由を返す。
 * **画面と一括取り込みで同じ判定を使います**（別々に書くと必ず食い違う）。
 */
export const usability = (license, { allow, titleFree }) => {
  if (!allow.includes(String(license).toLowerCase()))
    return { ok: false, mark: "×", why: `${license} は allow にありません` };
  if (titleFree && !isTitleFree(license))
    return { ok: false, mark: "○", why: `${license} は題名の表示が条件です（この行は題名を伏せる用）` };
  return { ok: true, mark: isTitleFree(license) ? "◎" : "○", why: "" };
};

/* ---- 文字列の掃除 ---- */

/* **タグを外したら、実体参照も戻します。** コモンズの Artist 欄は HTML なので
   `&amp;` がそのまま残り、画面には「Nutrition, Food Safety &amp; Health」と出ます
   （views の esc がもう一度エスケープするため）。実際にそうなりました */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = s => String(s || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k in ENTITIES) return ENTITIES[k];
  if (k[0] === "#") {
    const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }
  return m;
});
const stripTags = s => decode(String(s || "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
/** 題名に構造化データの多言語ラベルが続くことがある（700字超）。QS: の手前で切る */
export const cleanTitle = s => stripTags(s).replace(/\s*(?:title|label)\s+QS:.*$/s, "").trim();
/** Artist 欄が同じ語を二度返すことがある（"Unknown authorUnknown author"） */
export const dedupe = s => {
  const t = stripTags(s);
  const half = t.length / 2;
  return (t.length % 2 === 0 && t.slice(0, half) === t.slice(half)) ? t.slice(0, half) : t;
};

/* ---- 候補あつめ ---- */

const asFile = n => (/^file:/i.test(n) ? n : `File:${n}`);

/**
 * **ウィキデータの実体から代表画像を引く。**
 * `entity: "ガウス"` のような日本語の語を、まず項目（Q番号）に解決してから
 * P18（画像）を読みます。**P18 は人が選んだ「これがその物の画像だ」**なので、
 * 全文検索より桁違いに当たります。同名の別人が居ても、候補として説明文
 * （「ドイツの数学者」）ごと並ぶので、画面で見分けられます。
 */
const fromEntity = async term => {
  const found = await call(WIKIDATA, {
    action: "wbsearchentities", search: term, language: "ja", uselang: "ja",
    type: "item", limit: "5",
  });
  const hits = found?.search || [];
  if (!hits.length) return [];
  const claims = await call(WIKIDATA, {
    action: "wbgetentities", ids: hits.map(h => h.id).join("|"), props: "claims",
  });
  const out = [];
  for (const h of hits) {
    const p18 = claims?.entities?.[h.id]?.claims?.P18 || [];
    for (const c of p18.slice(0, 2)) {
      const name = c?.mainsnak?.datavalue?.value;
      if (name) out.push({ title: asFile(name), via: `ウィキデータ ${h.id}`,
                           note: [h.label, h.description].filter(Boolean).join(" — ") });
    }
  }
  return out;
};

/**
 * **ウィキペディアの記事の代表画像を引く。**
 * 記事の先頭に出ている画像です。こちらも人が選んでいます。
 * `wikipedia: "カール・フリードリヒ・ガウス"`、英語なら `"en:Carl Friedrich Gauss"`。
 */
const fromWikipedia = async spec => {
  const m = /^([a-z]{2}):(.+)$/.exec(spec);
  const [lang, title] = m ? [m[1], m[2]] : ["ja", spec];
  const r = await call(wiki(lang), {
    action: "query", titles: title, prop: "pageimages", piprop: "name", redirects: "1",
  });
  const page = Object.values(r?.query?.pages || {})[0];
  return page?.pageimage
    ? [{ title: asFile(page.pageimage), via: `${lang}.wikipedia`, note: page.title || title }]
    : [];
};

/**
 * **写真だけを残す。** コモンズの「ファイル」は名前空間6のことなので、
 * `gcmtype: "file"` には音声も動画も PDF も入ります。実際に
 * `Category:Cumulus clouds` から `De-Cumuluswolke.ogg`（雲の解説音声）が、
 * `Category:Gallus gallus domesticus` から `Ryujin.tif` が来ました。
 * **候補が数件しかない行では、これが混ざるだけで全滅します。**
 */
const BITMAP = /\.(jpe?g|png|gif|tiff?|webp)$/i;
const onlyPhotos = list => list.filter(c => BITMAP.test(c.title));

const bareCat = c => String(c).replace(/^category:/i, "");

/**
 * **カテゴリを深くたどって、ライセンスで絞った検索。**
 *
 * これを足した理由は2つあります。
 *
 * 1. **大きなカテゴリは、中身がほとんど下位カテゴリです。**
 *    `Category:Ships` の直下にファイルはほぼ無く、`categorymembers` は空を返します。
 *    実際、21行が「候補がありません」で全滅しました。CirrusSearch の
 *    `deepcategory:` は下位カテゴリまで見るので、そこから実際の写真が出ます
 * 2. **候補が数件では、ライセンスで必ず全滅します。** コモンズの写真の多くは
 *    CC BY-SA で、こちらは使えません（共有継承が改変物に波及するため）。
 *    **使えるものを探すのではなく、使えるものだけを検索する**ほうが確実です。
 *    構造化データの P6216（著作権の状態）と P275（ライセンス）で先に絞ります
 *
 * 段は上から順に試し、**取れたところで止めません**（PD・CC0 を先頭に並べたいので、
 * 全部足してから重複を除きます）。**最後にライセンス無指定の段を置いてあるので、
 * 構造化データが付いていない写真も拾えます**（Q番号が違っていても、ここで拾えます）。
 */
export const deepQueries = (cat, { titleFree } = {}) => {
  const base = `deepcategory:"${bareCat(cat)}" filetype:bitmap`;
  const tiers = [
    `${base} haswbstatement:P6216=Q19652`,    // 著作権の状態 = パブリックドメイン
    `${base} haswbstatement:P275=Q6938433`,   // ライセンス = CC0
  ];
  // 題名を伏せる行（choiceArt・スワイプ）は PD・CC0 しか使えないので、
  // 無指定の段を足しません。足すと画面が使えない候補で埋まります。
  if (!titleFree) tiers.push(base);
  return tiers;
};

/**
 * **そのカテゴリが本当にあるか。**
 *
 * ここを確かめずに `deepcategory:` を投げると、**解決できなかったキーワードが
 * 落ちて、絞りこみだけの問い合わせになります。** つまり
 * `filetype:bitmap haswbstatement:P6216=Q19652` ——「コモンズ全体の PD 画像」です。
 * 実際にそれが起きて、雲の行に F-22 が、地層の行にゴッホの素描が、
 * コンテナ港の行に空母の被弾写真が来ました。**別々の行に同じ1枚が来た**のも
 * これが理由です（馬とサバナが、どちらもペガサスの彫刻になりました）。
 */
const categoryExists = async cat => {
  const r = await call(COMMONS, { action: "query", titles: `Category:${bareCat(cat)}` });
  const page = Object.values(r?.query?.pages || {})[0];
  return !!page && page.missing === undefined;
};

/**
 * **絞りこみだけの問い合わせが返すもの**を1度だけ引いて覚えておきます。
 * 候補にこれが混ざっていたら、**カテゴリも検索語も効かなかった証拠**なので落とします。
 * 原因がこちらの読みちがいでも、この網は効きます（結果の側で見ているため）。
 */
let genericCache = null;
const genericTitles = async () => {
  if (genericCache) return genericCache;
  genericCache = new Set();
  for (const srsearch of ["filetype:bitmap haswbstatement:P6216=Q19652",
                          "filetype:bitmap haswbstatement:P275=Q6938433"]) {
    try {
      const r = await call(COMMONS, {
        action: "query", list: "search", srsearch, srnamespace: "6", srlimit: "50",
      });
      for (const p of r?.query?.search || []) genericCache.add(p.title);
    } catch { /* 引けなければ網を張らないだけ。取り込みは止めない */ }
  }
  return genericCache;
};

const fromDeepCategory = async (cat, entry) => {
  if (!await categoryExists(cat)) return [];
  const generic = await genericTitles();
  const out = [];
  for (const srsearch of deepQueries(cat, entry)) {
    const r = await call(COMMONS, {
      action: "query", list: "search", srsearch, srnamespace: "6", srlimit: "40",
    });
    for (const p of r?.query?.search || [])
      if (!generic.has(p.title)) out.push({ title: p.title, via: "カテゴリ（深）", note: "" });
  }
  return onlyPhotos(out);
};

/** カテゴリの直下を並べる。小さなカテゴリではこれで足ります */
const fromCategory = async cat => {
  const r = await call(COMMONS, {
    action: "query", generator: "categorymembers",
    gcmtitle: `Category:${bareCat(cat)}`,
    gcmtype: "file", gcmlimit: "50",
  });
  return onlyPhotos(Object.values(r?.query?.pages || {})
    .map(p => ({ title: p.title, via: "カテゴリ", note: "" })));
};

/**
 * 全文検索。**当たらないので最後に見ます**（上のどれも空だったときの保険）。
 * ここにもライセンスの段を付けてあります。**題名を伏せる行では、使えない候補を
 * 並べても画面が × で埋まるだけ**だからです。
 */
export const searchQueries = (entry) => {
  if (!entry.search) return [];
  const base = ["filetype:bitmap", entry.insource ? `insource:"${entry.insource}"` : "", entry.search]
    .filter(Boolean).join(" ");
  const tiers = [
    `${base} haswbstatement:P6216=Q19652`,
    `${base} haswbstatement:P275=Q6938433`,
  ];
  if (!entry.titleFree) tiers.push(base);
  return tiers;
};

const fromSearch = async entry => {
  const generic = await genericTitles();
  const out = [];
  for (const srsearch of searchQueries(entry)) {
    const r = await call(COMMONS, {
      action: "query", list: "search", srsearch, srnamespace: "6", srlimit: "30",
    });
    for (const p of r?.query?.search || [])
      if (!generic.has(p.title)) out.push({ title: p.title, via: "全文検索", note: "" });
  }
  return onlyPhotos(out);
};

/**
 * ひとつの行について、候補をぜんぶ集めます。
 * **どの源が落ちても残りは進みます。** 片方の API が形を変えても、
 * 取り込み全体が止まらないようにするためです（落ちた源は `errors` に残す）。
 *
 * 順番は `commons`（名指し）→ 実体 → ウィキペディア → カテゴリ → 全文検索。
 * **人が選んだものを先に並べる**ので、画面の左上がいちばん確からしくなります。
 */
export const gather = async entry => {
  const out = [], errors = [], stats = [];
  /* **源ごとの件数を残します。** 全滅したときに「どの源が空だったのか」が
     分からないと、台帳の手がかりを直しようがありません。実際、21行が
     全滅したとき、カテゴリが空なのか写真以外が混ざったのかが出力から
     読めず、もう一往復かかりました。 */
  const add = async (label, fn) => {
    try { const got = await fn(); stats.push(`${label} ${got.length}`); out.push(...got); }
    catch (e) { stats.push(`${label} ✗`); errors.push(`${label}: ${e.message}`); }
  };
  if (entry.commons) out.push({ title: asFile(entry.commons), via: "名指し", note: "" });
  if (entry.entity)    await add("ウィキデータ", () => fromEntity(entry.entity));
  if (entry.wikipedia) await add("ウィキペディア", () => fromWikipedia(entry.wikipedia));
  if (entry.category)  await add("カテゴリ（深）", () => fromDeepCategory(entry.category, entry));
  if (entry.category)  await add("カテゴリ", () => fromCategory(entry.category));
  if (entry.search)    await add("全文検索", () => fromSearch(entry));
  const seen = new Set();
  /* **候補は120件で打ち切ります。** describe は50件ずつ束ねるので3回で済みます。
     これ以上並べても、人が見て選べる量を超えます */
  const cands = out.filter(c => !seen.has(c.title) && seen.add(c.title)).slice(0, 120);
  return { cands, errors, stats };
};

/**
 * 候補のライセンスと寸法を、**まとめて1回で**引きます。
 * コモンズは titles に50件まで束ねられるので、候補ごとに叩く必要はありません。
 */
export const describe = async (titles, thumb = WIDE) => {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const r = await call(COMMONS, {
      action: "query", titles: titles.slice(i, i + 50).join("|"),
      prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: String(thumb),
    });
    for (const p of Object.values(r?.query?.pages || {})) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const m = info.extmetadata || {};
      out.set(p.title, {
        title: p.title, license: normalizeLicense(m),
        objectName: cleanTitle(m.ObjectName?.value) || p.title.replace(/^File:/, ""),
        author: dedupe(m.Artist?.value) || "作者不明",
        licenseUrl: m.LicenseUrl?.value || "",
        thumb: info.thumburl || info.url, url: info.url,
        width: info.width, height: info.height,
      });
    }
  }
  return out;
};

/**
 * 決まった1枚を採って、webp を書き、台帳の欄を埋めます。
 * **台帳に書き戻すのはここだけです。** 画面から選んでも一括で採っても、
 * 同じ欄が同じ形で埋まります。
 */
export const adopt = async ({ desc, key, entry, root, out, sharp }) => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(join(root, out, "small"), { recursive: true });
  const res = await fetch(desc.thumb, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`画像が取れません (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const wide  = await sharp(buf).resize({ width: WIDE,  withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
  const small = await sharp(buf).resize({ width: SMALL, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
  await writeFile(join(root, out, `${key}.webp`), wide);
  await writeFile(join(root, out, "small", `${key}.webp`), small);
  const meta = await sharp(wide).metadata();
  Object.assign(entry, {
    file: key, title: desc.objectName, author: desc.author, license: desc.license,
    licenseUrl: desc.licenseUrl,
    source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(desc.title)}`,
    width: meta.width, height: meta.height,
  });
  return { wide: wide.length, small: small.length };
};
