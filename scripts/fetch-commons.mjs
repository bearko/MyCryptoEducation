#!/usr/bin/env node
/* Wikimedia Commons から写真を取り込み、data/images.json の台帳を埋める。
   実行は手動（CI では走らせない。相手先に負荷をかけないため）。

   使い方: node scripts/fetch-commons.mjs [キー ...]
     キーを省くと、台帳のうち file がまだ無いものだけを取りに行く。

   やること
     1. images.json の search でコモンズを検索する
     2. 候補のライセンスを見て、allow に載っているものだけを採る
     3. 640px の縮小版を public/commons/ に、360px を small/ に webp で書く
     4. 題名・作者・ライセンス・出典URLを台帳に書き戻す

   ライセンスの線は images.json の allow で引いている。CC BY-SA を採らないのは、
   改変物に同じライセンスが波及するため。表示のときのクレジットは views.js が出す。 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
let sharp;
try { sharp = (await import("sharp")).default; }
catch { console.error("sharp が見つかりません。先に npm install を走らせてください。"); process.exit(1); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "public/commons";
const API = "https://commons.wikimedia.org/w/api.php";
/* コモンズは素性の分かる User-Agent を求める。連絡先の無いものは弾かれることがある */
const UA = "sekai-no-kyoushitsu/0.4 (educational quiz; https://github.com/bearko/MyCryptoEducation)";
const WIDE = 640, SMALL = 360;
const WAIT = 1200;   // 1件ごとに待つ。相手のサーバに連続で叩き込まない

const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async params => {
  const url = `${API}?${new URLSearchParams({ format: "json", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
};

const bookPath = join(ROOT, "data/images.json");
const book = JSON.parse(await readFile(bookPath, "utf8"));
const allow = book.allow.map(s => s.toLowerCase());
const entries = Object.entries(book.images);
const wanted = process.argv.slice(2).length
  ? entries.filter(([k]) => process.argv.slice(2).includes(k))
  : entries.filter(([, v]) => !v.file || !existsSync(join(ROOT, OUT, v.file + ".webp")));

if (!wanted.length) { console.log("取りに行くものはありません。"); process.exit(0); }
await mkdir(join(ROOT, OUT, "small"), { recursive: true });

/* ライセンス名の表記ゆれを吸収する。コモンズは "cc-by-4.0" の形で返してくる */
const normalizeLicense = m => {
  const short = m?.LicenseShortName?.value || "";
  const code = (m?.License?.value || "").toLowerCase();
  if (short) return short;
  if (code.startsWith("cc-by-sa")) return "CC BY-SA " + code.split("-").pop();
  if (code.startsWith("cc-by")) return "CC BY " + code.split("-").pop();
  if (code === "cc0") return "CC0";
  if (code.includes("pd")) return "Public domain";
  return code || "不明";
};
const stripTags = s => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

let ok = 0, ng = 0;
for (const [key, entry] of wanted) {
  try {
    if (!entry.search) { console.warn(`  ${key}: search がありません`); ng++; continue; }
    const found = await api({
      action: "query", generator: "search", gsrsearch: `filetype:bitmap ${entry.search}`,
      gsrnamespace: "6", gsrlimit: "8",
      prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: String(WIDE),
    });
    const pages = Object.values(found?.query?.pages || {});
    if (!pages.length) { console.warn(`  ${key}: 見つかりません（${entry.search}）`); ng++; continue; }

    const hit = pages.map(p => {
      const info = p.imageinfo?.[0] || {};
      return { page: p, info, license: normalizeLicense(info.extmetadata) };
    }).find(c => allow.includes(c.license.toLowerCase()));

    if (!hit) {
      console.warn(`  ${key}: 使えるライセンスの候補がありません（${
        pages.map(p => normalizeLicense(p.imageinfo?.[0]?.extmetadata)).join(" / ")}）`);
      ng++; continue;
    }

    const src = hit.info.thumburl || hit.info.url;
    const res = await fetch(src, { headers: { "User-Agent": UA } });
    if (!res.ok) { console.warn(`  ${key}: 取得できません (${res.status})`); ng++; continue; }
    const buf = Buffer.from(await res.arrayBuffer());

    const file = key;
    const wide = await sharp(buf).resize({ width: WIDE, withoutEnlargement: true })
      .webp({ quality: 76 }).toBuffer();
    const small = await sharp(buf).resize({ width: SMALL, withoutEnlargement: true })
      .webp({ quality: 70 }).toBuffer();
    await writeFile(join(ROOT, OUT, `${file}.webp`), wide);
    await writeFile(join(ROOT, OUT, "small", `${file}.webp`), small);
    const meta = await sharp(wide).metadata();

    const m = hit.info.extmetadata || {};
    Object.assign(entry, {
      file,
      title: stripTags(m.ObjectName?.value) || hit.page.title.replace(/^File:/, ""),
      author: stripTags(m.Artist?.value) || "作者不明",
      license: hit.license,
      licenseUrl: m.LicenseUrl?.value || "",
      source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(hit.page.title)}`,
      width: meta.width, height: meta.height,
    });
    console.log(`  ✓ ${key}  ${entry.license}  ${Math.round(wide.length / 1024)}KB / small ${
      Math.round(small.length / 1024)}KB`);
    ok++;
  } catch (e) {
    console.warn(`  ${key}: ${e.message}`);
    ng++;
  }
  await sleep(WAIT);
}

await writeFile(bookPath, JSON.stringify(book, null, 2) + "\n");
console.log(`\n取り込み ${ok}件 / 見送り ${ng}件  →  ${OUT}/`);
console.log("data/images.json を更新しました。npm run validate で確かめてください。");
