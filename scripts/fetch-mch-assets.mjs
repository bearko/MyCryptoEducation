#!/usr/bin/env node
/* MyCryptoHeroes のアセットを public/ に取り込む。
   MCH社から許諾を得た範囲で利用する。実行は手動（毎回叩かない）。
   使い方: node scripts/fetch-mch-assets.mjs                       */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = "https://raw.githubusercontent.com/bearko/mycryptoheroes/main";

/* data/heroes.json に載っている英雄と、その Rep.画像（id + 10000） */
const heroes = JSON.parse(await readFile(join(ROOT, "data/heroes.json"), "utf8"));
const roster = heroes.map(h => h.id);
const reps = heroes.filter(h => !h.own).map(h => String(Number(h.id) + 10000));

/* ホームのボタンに重ねる英雄。ロスターには入らないが画像だけ使う */
const UI_HEROES = ["2023", "3037"];   // クラフト（ミケランジェロ）/ ショップ

const BACKGROUNDS = ["1006", "1038", "1046", "1030", "1004"];
const ICONS = ["mai_sd", "gum", "mch_icon"];
/* エクステンション40種。8系統 × 5レアリティ（docs/implementation-plan.md §0 のID表） */
const EXTENSIONS = [
  "1003", "2003", "3003", "4003", "5003",   // ペン
  "1001", "2001", "3001", "4001", "5001",   // ブレード
  "1030", "2030", "3030", "4030", "5030",   // ゴブレット
  "1059", "2059", "3059", "4059", "5059",   // ハット
  "1017", "2017", "3017", "4017", "5017",   // ネックレス
  "1016", "2016", "3016", "4016", "5016",   // スクロール
  "1032", "2032", "3032", "4032", "5032",   // センス
  "1008", "2008", "3008", "4008", "5008",   // ブック
];
const GEMSTONES = ["315", "325", "335", "345"];

/* 上限サイズ。withoutEnlargement なので、これより小さい原本はそのまま通る。
   MCH の英雄・エクステンション画像は原本が 64x64 なので、実際には拡大されない。
   ホームの主役層で Rep. を出すときは、この解像度を前提に表示サイズを決めること */
const SIZE = { hero: 128, ext: 128, icon: 128, bg: 1080, gem: 72 };

/* 単一ファイル版（dist/index.html）に data URI で畳む用の縮小コピー。
   1080px のまま base64 にすると1枚で数百KBになり、配布ファイルが実用外の大きさになる */
const BG_EMBED = { size: 480, quality: 60 };

async function grab(url, out, size, quality = 88) {
  const res = await fetch(url);
  if (!res.ok) { console.warn(`  スキップ ${url} (${res.status})`); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  let img = sharp(buf);
  if (size) img = img.resize(size, size, { fit: "inside", withoutEnlargement: true });
  await writeFile(join(ROOT, out), await img.webp({ quality }).toBuffer());
  return buf;
}

let n = 0;
const count = async (...args) => { if (await grab(...args)) n++; };

await mkdir(join(ROOT, "public/heroes"), { recursive: true });
for (const id of roster)
  await count(`${RAW}/Image/Heroes/${id}.png`, `public/heroes/${id}.webp`, SIZE.hero);
for (const id of reps)
  await count(`${RAW}/Image/Heroes/${id}.png`, `public/heroes/${id}.webp`, SIZE.hero);
for (const id of UI_HEROES)
  await count(`${RAW}/Image/Heroes/${id}.png`, `public/heroes/${id}.webp`, SIZE.hero);

await mkdir(join(ROOT, "public/extensions"), { recursive: true });
for (const id of EXTENSIONS)
  await count(`${RAW}/Image/Extensions/${id}.png`, `public/extensions/${id}.webp`, SIZE.ext);

await mkdir(join(ROOT, "public/backgrounds/small"), { recursive: true });
for (const id of BACKGROUNDS) {
  const src = await grab(`${RAW}/Image/Backgrounds/${id}.png`, `public/backgrounds/${id}.webp`, SIZE.bg);
  if (!src) continue;
  n++;
  await writeFile(join(ROOT, `public/backgrounds/small/${id}.webp`),
    await sharp(src).resize(BG_EMBED.size, BG_EMBED.size, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: BG_EMBED.quality }).toBuffer());
}

await mkdir(join(ROOT, "public/icons"), { recursive: true });
for (const name of ICONS)
  await count(`${RAW}/Image/Icons/${name}.png`, `public/icons/${name}.webp`, SIZE.icon);

await mkdir(join(ROOT, "public/materials/gemstones"), { recursive: true });
for (const id of GEMSTONES)
  await count(`${RAW}/Image/Materials/Gemstones/${id}.webp`, `public/materials/gemstones/${id}.webp`, SIZE.gem);

console.log(`${n}点を取得しました`);
