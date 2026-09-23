/* **画面ごとのID一覧と、その画面の出し方。**
   `npm run shots` がこの表どおりに全画面を開いて撮り、`docs/screens/` に並べます。

   レビューの単位は**ビューではなく状態**にしてあります。クイズは1つのビューですが、
   4択・消去法・文字パネル・数値入力・レンジ・スワイプで見た目が別物なので、
   「クイズ画面が変」と言われても直す先が決まりません。

   **番号は使い回しません。** 画面を足すときは末尾に足してください。途中に差しこむと、
   過去のレビューの番号が別の画面を指すようになります。

   ID の判定そのものは `views.screenId()` が持っています。**撮影はその戻り値を
   ここの id と突き合わせるので、2つがズレたら落ちます。** */

/** 進行を作りこむ。画面によって、解いた記録や手持ちが要る */
const SEED = {
  fresh: {},                                   // 何もしていない状態（初回起動）
  ready: { introDone: true, runs: 3, gum: 480, totalRight: 42 },
};

/* よく使う下ごしらえ。ページの中で動く関数なので、外の変数は文字列で渡す。
   **初回起動の run を必ず畳みます。** 開いた直後は startIntro() が走っていて、
   `modeOf` が「初回の最初の数問は4択」の枝に入ります。そこは
   `S.run.ids.indexOf(q.id) < INTRO_PLAIN` で見ているので、**一覧に無い問題は
   indexOf が -1 を返し、全問が「4択」に見えます。** 実際これで S-05 に
   消去法の絵が入りかけました */
const setup = async (page, patch = {}) => {
  await page.evaluate(p => {
    Object.assign(S, p);
    S.toast = null;
    Object.assign(S.run, { ids: [], i: 0, picked: null, intro: false, swipe: false,
                           hard: {}, results: {}, applied: null, cut: null, done: false });
  }, { ...SEED.ready, ...patch });
};

/** その形式の問題を1問だけ出す。`want` は modeOf が返す名前 */
const quizOf = async (page, want) => {
  await setup(page);
  const found = await page.evaluate(w => {
    const q = DB.questions.find(q => {
      if (!questionOpen(S, q)) return false;
      try { return modeOf(q) === w; } catch { return false; }
    });
    if (!q) return null;
    startRun({ ids: [q.id] });
    return q.id;
  }, want);
  if (!found) throw new Error(`${want} の問題が見つかりません`);
  return found;
};

export const SCREENS = [
  { id: "S-01", name: "初回起動（無説明）", note: "学年を選んだ直後。ホームもチュートリアルも出さない",
    go: async page => { await page.evaluate(() => {
      Object.assign(S, { introDone: false, startGrade: "e1" }); startIntro(); }); } },

  { id: "S-02", name: "ホーム", note: "3層。上がステータス、中が挑む相手、下がナビ",
    go: async page => { await setup(page); await page.evaluate(() => go("home")); await page.waitForTimeout(400); } },

  { id: "S-03", name: "知識マップ", note: "教科×学年のマス目。ホームから1タップで開く",
    go: async page => { await setup(page, { cells: { "国語|e1": 1, "算数・数学|e1": 1, "理科|j1": 1 } });
                        await page.evaluate(() => go("map")); } },

  { id: "S-04", name: "出題を選ぶ", note: "毎回くじで3教科。学年は教科ごとに知識マップから決まる",
    go: async page => {
      await setup(page);
      /* くじは撮るたびに変わるので、絵が毎回別ものにならないよう固定する */
      await page.evaluate(() => {
        S.select.picks = ["国語", "算数・数学", "理科"];
        S.select.seed = 7; S.select.subject = "auto"; S.select.run = null;
        go("select");
      });
      await page.waitForTimeout(250);
    } },

  { id: "S-05", name: "出題・4択",      note: "青い帯。正しいものを1つ選ぶ", go: p => quizOf(p, "choice") },
  { id: "S-06", name: "出題・消去法",    note: "朱の帯。誤っているものを3つ消す", go: p => quizOf(p, "elimination") },
  { id: "S-07", name: "出題・文字パネル", note: "3×3／4×4 をなぞって読みを作る", go: p => quizOf(p, "panel") },
  { id: "S-08", name: "出題・数値入力",  note: "テンキー。単位は固定表示", go: p => quizOf(p, "numeric") },
  { id: "S-09", name: "出題・レンジ",    note: "年を幅で答える", go: p => quizOf(p, "range") },
  { id: "S-10", name: "出題・スワイプ",  note: "カードを正しいと思うほうへはらう", go: p => quizOf(p, "swipe") },

  /* **バトル層の無い解説はここだけです。** ふつうのセッションには必ず敵が
     いるので、答えたあとは S-26 になります（初回起動だけバトルを立てない） */
  { id: "S-11", name: "解説（バトルなし）", note: "初回起動の解答。ふつうのセッションは S-26",
    go: async page => {
      await setup(page);
      await page.evaluate(() => { startRun({ ids: ["sansu-105"], intro: true }); });
      await page.waitForTimeout(150);
      await page.evaluate(() => { const q = DB.byId["sansu-105"];
        document.querySelector(`.choices .choice[data-i="${q.answer}"]`)?.click(); });
      await page.waitForTimeout(250);
    } },

  { id: "S-12", name: "応用編（二段構え）", note: "正解したときだけ出る。定理 → 発見者",
    go: async page => {
      await SCREENS.find(s => s.id === "S-11").go(page);
      await page.evaluate(() => [...document.querySelectorAll("button, a")]
        .find(b => /応用編/.test(b.textContent))?.click());
      await page.waitForTimeout(200);
    } },

  { id: "S-13", name: "スワイプのふりかえり", note: "解説をまとめて出す。外した問題は開いた状態",
    go: async page => {
      await setup(page);
      await page.evaluate(() => {
        const ids = DB.questions.filter(q => q.format === "swipe").slice(0, 4).map(q => q.id);
        startRun({ ids, swipe: true });
        ids.forEach((id, i) => { S.run.results[id] = i === 1 ? "ng" : "ok"; });
        S.run.right = ids.length - 1; S.run.wrong = 1; S.run.i = ids.length;
        S.run.done = true; go("result");
      });
    } },

  { id: "S-14", name: "リザルト", note: "今回のGUM・段が上がった知らせ・ふりかえり",
    go: async page => {
      await setup(page);
      await page.evaluate(() => {
        const ids = DB.questions.filter(q => (q.format || "choice") === "choice").slice(0, 4).map(q => q.id);
        startRun({ ids });
        ids.forEach((id, i) => { S.run.results[id] = i === 3 ? "ng" : "ok"; });
        S.run.right = 3; S.run.wrong = 1; S.run.gum = 14; S.run.i = ids.length;
        S.run.done = true; go("result");
      });
    } },

  { id: "S-15", name: "ヒーロー・手持ち", note: "英雄・知識カード・クリスタル",
    go: async page => { await setup(page, { heroesTab: "own", cards: { "かたかなで書く言葉": 1, "組にして足す": 1 } });
                        await page.evaluate(() => go("heroes")); } },

  { id: "S-16", name: "ヒーロー・図鑑", note: "未解放の英雄も到達度つきで並ぶ",
    go: async page => { await setup(page, { heroesTab: "codex" }); await page.evaluate(() => go("heroes")); } },

  { id: "S-17", name: "英雄の詳細・装備", note: "誰への到達度を見るか選べる。候補に差分が並ぶ",
    go: async page => { await setup(page, { exts: { "1": 1, "2": 1 } });
                        await page.evaluate(() => { S.heroView = Object.keys(S.owned)[0]; go("hero"); }); } },

  { id: "S-18", name: "挑戦先を選ぶ", note: "どれだけゲージを削れるかはここで見せる",
    go: async page => { await setup(page); await page.evaluate(() => go("target")); } },

  { id: "S-19", name: "チャレンジ", note: "1回3問。自由入力",
    /* **`startChallenge` を通します。** 到達度の内訳（breakdown）はそこで作られるので、
       状態を手で組み立てると null のまま vChallenge が落ちます */
    go: async page => { await setup(page, { cards: { "かたかなで書く言葉": 1, "組にして足す": 1 } });
      await page.evaluate(() => startChallenge(DB.heroes.find(h => !S.owned[h.id]).id)); } },

  { id: "S-20", name: "クラフト", note: "ランクごとのタブ。作れるものから順に並ぶ",
    go: async page => { await setup(page, { points: { 石英: 300, 元素: 300, 貴金属: 300, 宝石: 300, 鉱石: 300, 生物起源: 300 } });
                        await page.evaluate(() => go("craft")); } },

  { id: "S-21", name: "ショップ", note: "GUMの所持数を出すのはここだけ",
    go: async page => { await setup(page); await page.evaluate(() => go("shop")); } },

  { id: "S-22", name: "カレンダー", note: "解いた日にスタンプ。連続日数は数えない",
    go: async page => {
      await setup(page);
      await page.evaluate(() => {
        const k = new Date().toISOString().slice(0, 10);
        S.days = { [k]: { runs: 1, right: 8, wrong: 2, appliedRight: 1, gum: 22, results: {} } };
        openCalendar();   // 見ている月の既定はここで入る。go だけだと S.calendar が null
      });
    } },

  { id: "S-23", name: "その日の記録", note: "成績と各問の解説。ここから再挑戦もできる（報酬なし）",
    go: async page => {
      await setup(page);
      await page.evaluate(() => {
        const k = new Date().toISOString().slice(0, 10);
        const ids = DB.questions.slice(0, 4).map(q => q.id);
        const results = {}; ids.forEach((id, i) => { results[id] = i === 2 ? "ng" : "ok"; });
        S.days = { [k]: { runs: 1, right: 3, wrong: 1, appliedRight: 0, gum: 12, results } };
        S.dayView = k; go("day");
      });
    } },

  { id: "S-24", name: "マイページ", note: "名前・アイコン・称号・設定。未取得の称号は名前を伏せる",
    go: async page => { await setup(page); await page.evaluate(() => go("mypage")); } },

  /* **番号は使い回さない。** 足すときは末尾へ（途中に差しこむと、過去の
     レビューの番号が別の画面を指すようになる） */
  { id: "S-25", name: "出題を選ぶ・教科を選んだあと", note: "形式3つとエネミーが出て、背景がその教科の絵に変わる",
    go: async page => {
      await SCREENS.find(s => s.id === "S-04").go(page);
      await page.evaluate(() => { document.querySelectorAll(".scard")[2].click(); });
      await page.waitForTimeout(300);
    } },

  { id: "S-26", name: "出題・答えたあと（バトル）", note: "正解すると敵が削れる。倒れた敵は伏せる",
    go: async page => {
      await setup(page);
      await page.evaluate(() => {
        const ids = DB.questions.filter(q => q.subject === "国語" && q.mode === "elimination")
          .slice(0, 4).map(q => q.id);
        S.select.subject = "国語"; S.select.seed = 3;
        startRun({ built: { ids, plan: [{ mode: "elimination", n: 4, level: 1 }] } });
        document.getElementById("wvgo").click();   // 接敵の画面から問題へ
      });
      await page.waitForTimeout(250);
      await page.evaluate(() => { const q = DB.byId[S.run.ids[0]];
        for (let i = 0; i < q.choices.length; i++)
          if (i !== q.answer) document.querySelector(`.xcut[data-c="${i}"]`)?.click(); });
      await page.waitForTimeout(400);
    } },

  /* ポップアップは2つとも、下の画面を動かさずに重なる。**元の画面が
     動かないことがこの形の目的**なので、絵でも確かめられるようにしておく */
  { id: "S-27", name: "ヒント（ポップアップ）", note: "元の画面は動かない。もう一段でだけ本数が増える",
    go: async page => {
      await quizOf(page, "elimination");
      await page.evaluate(() => {
        document.getElementById("hint")?.click();
        document.getElementById("hintmore")?.click();
      });
      await page.waitForTimeout(200);
    } },

  { id: "S-28", name: "設定（ポップアップ）", note: "正解した問題の解説を見るかどうか",
    go: async page => {
      await quizOf(page, "elimination");
      await page.evaluate(() => { document.getElementById("gear")?.click(); });
      await page.waitForTimeout(200);
    } },

  /* 束の切れ目。**敵に出会った → 解いて倒す → 倒せた／逃げられた** の筋を
     受け持つ2枚。出題の画面はバトルを小さく畳んでいるので、ここが見せ場 */
  { id: "S-29", name: "Wave開始（接敵）", note: "英雄が画面の外から入り、敵の体力が満ちる",
    go: async page => {
      await setup(page);
      await page.evaluate(() => {
        const ids = DB.questions.filter(q => q.subject === "国語" && q.mode === "elimination")
          .slice(0, 3).map(q => q.id);
        S.select.subject = "国語"; S.select.seed = 3;
        startRun({ built: { ids, plan: [{ mode: "elimination", n: 3, level: 1 }] } });
      });
      await page.waitForTimeout(900);          // 入ってくる演出とゲージが満ちるのを待つ
    } },

  { id: "S-30", name: "Wave終了（戦果）", note: "撃破！／逃げられた……と、その束ぶんの成績と報酬",
    go: async page => {
      await SCREENS.find(s => s.id === "S-29").go(page);
      await page.evaluate(() => {
        document.getElementById("wvgo").click();
        for (let k = 0; k < 3; k++) {
          const q = DB.byId[S.run.ids[S.run.i]];
          for (let i = 0; i < q.choices.length; i++)
            if (i !== q.answer) document.querySelector(`.xcut[data-c="${i}"]`)?.click();
          document.getElementById("next")?.click();
        }
      });
      await page.waitForTimeout(400);
    } },

  /* **初回に1度だけ出る。** 決定1をひとつだけゆるめた画面で、
     聞くのは学年ひとつ、答えるのは1タップ。説明は置かない */
  { id: "S-31", name: "何年生から始める?", note: "初回に1度だけ。選んだ学年が梯子の下端になる",
    go: async page => {
      await page.evaluate(() => {
        Object.assign(S, { introDone: false, startGrade: null, runs: 0 });
        startIntro();
      });
      await page.waitForTimeout(200);
    } },

  /* 必殺技（英雄のパッシブスキル）。**解説を省く設定でも応用編に挑める** */
  { id: "S-32", name: "必殺技発動チャンス", note: "解説を省いていても、隙を見せた問題では応用編に挑める",
    go: async page => {
      await setup(page);
      await page.evaluate(() => {
        const hero = DB.subjectArt["国語"].hero;
        const q = DB.questions.find(x => x.applied && x.subject === "国語" &&
          x.mode === "elimination" && skillChance(x, hero));
        S.settings.showExplanationOnCorrect = false;
        S.select.subject = "国語"; S.select.seed = 3;
        startRun({ built: { ids: [q.id], plan: [{ mode: "elimination", n: 1, level: 1 }] } });
        document.getElementById("wvgo").click();
        for (let i = 0; i < q.choices.length; i++)
          if (i !== q.answer) document.querySelector(`.xcut[data-c="${i}"]`)?.click();
      });
      await page.waitForTimeout(250);
    } },

  { id: "S-33", name: "必殺技のカットイン", note: "応用編を抜けると出る。MCH のパッシブスキル演出を写したもの",
    viewport: true,          // 画面に重なるものなので、表示領域のぶんだけ撮る
    go: async page => {
      await SCREENS.find(s => s.id === "S-32").go(page);
      await page.evaluate(() => {
        document.getElementById("skgo").click();
        const q = DB.byId[S.run.ids[0]];
        document.querySelectorAll("#exch > .choice")[q.applied.answer].click();
        /* **帯だけを出し直して撮ります。** 本物は 1.2 秒で消えるので、
           待っていると撮るころには終わっています（一度そうなりました）。
           出しているものは本物とまったく同じです（`views.skillCutIn`） */
        document.querySelector(".skcut")?.remove();
        skillCutIn(S.run.battle.heroId, skillName(DB.battle, S.run.battle.heroId));
      });
      await page.waitForTimeout(150);
    } },

  /* ---- 黒ウィズ型リデザイン ---- */

  /* SSを撃つ（デッキの枠から開く）。**下に何があっても見た目はポップアップのもの** */
  { id: "S-34", name: "スペシャルスキルを撃つ",
    note: "デッキの枠から開く。溜まっていないものも、あと何問かを出して並べる",
    viewport: true,
    go: async page => {
      await setup(page);
      await page.evaluate(() => {
        const ext = Object.values(DB.extensions).find(e => DB.extSkills[e.id].effect <= 2);
        S.exts[ext.id] = 1;
        const q = DB.questions.find(x => x.subject === "国語" && x.mode === "elimination");
        S.select.subject = "国語"; S.select.seed = 3;
        startRun({ built: { ids: [q.id], plan: [{ mode: "elimination", n: 1, level: 1 }] } });
        document.getElementById("wvgo").click();
        S.deckExt[S.run.battle.deck[0].id] = ext.id;
        S.run.battle.ss[0] = ssNeed(ext);
        S.run.ssOpen = true;
        drawSS();
      });
      await page.waitForTimeout(200);
    } },

  /* **デッキ編成。黒ウィズの芯がここにあります。**
     見せたいことは1つだけ —— 左が先で、右ほど落ちる */
  { id: "S-35", name: "デッキ編成", note: "5枚。左が先で、右ほどASが落ちる。コスト上限は知識マップが伸ばす",
    go: async page => {
      await setup(page);
      await page.evaluate(() => { S.view = "deck"; render(); });
      await page.waitForTimeout(150);
    } },

  { id: "S-36", name: "枠に入れるヒーローを選ぶ",
    note: "未解放は名前を伏せ、条件と進み具合だけ見せる。ガチャは無い",
    go: async page => {
      await setup(page);
      await page.evaluate(() => { S.deckPick = 2; S.view = "deckpick"; render(); });
      await page.waitForTimeout(150);
    } },

  { id: "S-37", name: "エクステンションを装備してSSを決める",
    note: "クラフトの出口がSSになる。●の数が必要正解数",
    go: async page => {
      await setup(page);
      await page.evaluate(() => {
        Object.keys(DB.extensions).slice(0, 6).forEach(id => S.exts[id] = 1);
        S.deckPick = S.deck[0];
        S.view = "deckext"; render();
      });
      await page.waitForTimeout(150);
    } },
];