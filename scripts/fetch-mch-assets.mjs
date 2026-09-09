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
const heroIds = heroes.flatMap(h => {
  const ids = [h.id];
  if (!h.own) ids.push(String(Number(h.id) + 10000));   // 解放前に見せる Rep.
  return ids;
});

const BACKGROUNDS = ["1006", "1038", "1046", "1030", "1004"];
const ICONS = ["mai_sd", "gum", "mch_icon"];
const GEMSTONES = ["315", "325", "335", "345"];

async function grab(url, out, size) {
  const res = await fetch(url);
  if (!res.ok) { console.warn(`  スキップ ${url} (${res.status})`); return false; }
  const buf = Buffer.from(await res.arrayBuffer());
  let img = sharp(buf);
  if (size) img = img.resize(size, size, { fit: "inside", withoutEnlargement: true });
  await writeFile(join(ROOT, out), await img.webp({ quality: 88 }).toBuffer());
  return true;
}

let n = 0;
await mkdir(join(ROOT, "public/heroes"), { recursive: true });
for (const id of heroIds)
  if (await grab(`${RAW}/Image/Heroes/${id}.png`, `public/heroes/${id}.webp`, 64)) n++;

await mkdir(join(ROOT, "public/backgrounds"), { recursive: true });
for (const id of BACKGROUNDS)
  if (await grab(`${RAW}/Image/Backgrounds/${id}.png`, `public/backgrounds/${id}.webp`, 1080)) n++;

await mkdir(join(ROOT, "public/icons"), { recursive: true });
for (const name of ICONS)
  if (await grab(`${RAW}/Image/Icons/${name}.png`, `public/icons/${name}.webp`, 128)) n++;

await mkdir(join(ROOT, "public/materials/gemstones"), { recursive: true });
for (const id of GEMSTONES)
  if (await grab(`${RAW}/Image/Materials/Gemstones/${id}.webp`, `public/materials/gemstones/${id}.webp`, 72)) n++;

console.log(`${n}点を取得しました`);
