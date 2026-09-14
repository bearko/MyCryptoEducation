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

/** コモンズは "cc-by-4.0" の形で返してくる。表記ゆれを吸収する */
export const normalizeLicense = m => {
  const short = m?.LicenseShortName?.value || "";
  const code = (m?.License?.value || "").toLowerCase();
  if (short) return short;
  if (code.startsWith("cc-by-sa")) return "CC BY-SA " + code.split("-").pop();
  if (code.startsWith("cc-by")) return "CC BY " + code.split("-").pop();
  if (code === "cc0") return "CC0";
  if (code.includes("pd")) return "Public domain";
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

const stripTags = s => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
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

/** カテゴリの中身を並べる。ものを何枚か見比べたいときに効く */
const fromCategory = async cat => {
  const r = await call(COMMONS, {
    action: "query", generator: "categorymembers",
    gcmtitle: /^category:/i.test(cat) ? cat : `Category:${cat}`,
    gcmtype: "file", gcmlimit: "30",
  });
  return Object.values(r?.query?.pages || {}).map(p => ({ title: p.title, via: "カテゴリ", note: "" }));
};

/** 全文検索。**当たらないので最後に見ます**（上の3つが空だったときの保険） */
const fromSearch = async (entry, limit = 30) => {
  const q = ["filetype:bitmap", entry.insource ? `insource:"${entry.insource}"` : "", entry.search]
    .filter(Boolean).join(" ");
  if (!entry.search) return [];
  const r = await call(COMMONS, {
    action: "query", list: "search", srsearch: q, srnamespace: "6", srlimit: String(limit),
  });
  return (r?.query?.search || []).map(p => ({ title: p.title, via: "全文検索", note: "" }));
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
  const out = [], errors = [];
  const add = async (label, fn) => {
    try { out.push(...await fn()); }
    catch (e) { errors.push(`${label}: ${e.message}`); }
  };
  if (entry.commons) out.push({ title: asFile(entry.commons), via: "名指し", note: "" });
  if (entry.entity)    await add("ウィキデータ", () => fromEntity(entry.entity));
  if (entry.wikipedia) await add("ウィキペディア", () => fromWikipedia(entry.wikipedia));
  if (entry.category)  await add("カテゴリ", () => fromCategory(entry.category));
  if (entry.search)    await add("全文検索", () => fromSearch(entry));
  const seen = new Set();
  return { cands: out.filter(c => !seen.has(c.title) && seen.add(c.title)), errors };
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
