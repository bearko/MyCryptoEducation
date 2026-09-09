import { loadDatabase } from "./data.js";
import { createState } from "./state.js";
import { mount } from "./views.js";

const root = document.getElementById("app");

loadDatabase()
  .then(db => mount(db, createState(), root))
  .catch(err => {
    root.innerHTML = `<div class="pad"><div class="title-wrap">
      <h1>読み込めませんでした</h1><div class="rule"></div>
      <p class="lede">${String(err.message)}</p>
      <p class="fine">ローカルで開く場合は <code>npm start</code> を使ってください。
      file:// から直接開くとJSONを読み込めません。</p></div></div>`;
    console.error(err);
  });
