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

/* 背景。1030 が既定で、1001〜1004 と 1010 が「出題を選ぶ」の教科ごとの絵。
   **外国語は 1005 のつもりでしたが、その番号は存在しません**（404）。
   代わりの 1006 は国語の 1001 とほぼ同じ絵なので、赤系の 1010 を当てています */
const BACKGROUNDS = ["1006", "1038", "1046", "1030",
                     "1001", "1002", "1003", "1004", "1010"];
const ICONS = ["mai_sd", "gum", "mch_icon"];

/* 「出題を選ぶ」で教科の札に乗せる英雄。**ロスターとは別**で、絵だけ借ります */
const SUBJECT_HEROES = ["4056", "10006", "5027", "10004", "3030"];

/* **マインちゃん**（`navi_ain`）。読み上げ役として画面に立ちます。
   原本は 96x128 のドット絵なので、大きく出すときは image-rendering: pixelated を
   付けてください（英雄と同じ理由）。表情は用途ごとに使い分けます */
const NAVI = ["navi_ain_11_idle", "navi_ain_12_blink",
              "navi_ain_03_wave", "navi_ain_07_talk", "navi_ain_08_sparkle",
              "navi_ain_02_both_arms_up", "navi_ain_06_smile"];

/* エネミー。IDの並びが教科に対応しています（310国語 / 320算数・数学 / 330理科 /
   340社会 / 350外国語）。**在るものだけ採ります** —— 番号が飛んでいても止めません */
const ENEMIES = Array.from({ length: 50 }, (_, i) => String(310 + i));
/* エクステンションは data/extensions-curated.json の108種。
   ここに列挙せず台帳から読むので、品を足したら取り込みも自動で追いつく */
const curated = JSON.parse(await readFile(join(ROOT, "data/extensions-curated.json"), "utf8"));
const EXTENSIONS = curated.map(e => e.id);

/* 上限サイズ。withoutEnlargement なので、これより小さい原本はそのまま通る。
   MCH の英雄・エクステンション画像は原本が 64x64 なので、実際には拡大されない。
   ホームの主役層で Rep. を出すときは、この解像度を前提に表示サイズを決めること */
const SIZE = { hero: 128, ext: 128, icon: 128, bg: 1080, navi: 256 };

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
for (const id of SUBJECT_HEROES)
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

await mkdir(join(ROOT, "public/enemies"), { recursive: true });
for (const id of ENEMIES)
  await count(`${RAW}/Image/Enemies/${id}.png`, `public/enemies/${id}.webp`, SIZE.hero);

await mkdir(join(ROOT, "public/characters"), { recursive: true });
for (const name of NAVI)
  await count(`${RAW}/Image/Characters/${name}.png`, `public/characters/${name}.webp`, SIZE.navi);

await mkdir(join(ROOT, "public/icons"), { recursive: true });
for (const name of ICONS)
  await count(`${RAW}/Image/Icons/${name}.png`, `public/icons/${name}.webp`, SIZE.icon);

console.log(`${n}点を取得しました`);
