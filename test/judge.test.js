'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadEngine, strokesFrom } = require('./helpers');
const { RAW, svgText, EXPECTED_ENDINGS, EXPECTED_RELATIONS } = require('./kanjivg-fixtures');

const K = loadEngine();
const SIZE = 400;               // WRITE モードのキャンバス一辺
const px = (v) => v * SIZE;     // 正規化座標 → キャンバス座標

/** 手本モデル（実際の KanjiVG データから作る） */
const model = {};
for (const ch of Object.keys(RAW)) model[ch] = K.modelFromKanjiVg(svgText(ch));

// ============================================================
// SVG の解析
// ============================================================
test('KanjiVG の path から d と kvg:type を取り出せる', () => {
  const strokes = K.extractKanjiVgStrokes(svgText('十'));
  assert.strictEqual(strokes.length, 2);
  assert.strictEqual(strokes[0].type, '㇐');
  assert.strictEqual(strokes[1].type, '㇑');
  assert.ok(strokes[0].d.startsWith('M11.88,50.98'));
});

test('パス解析は始点と終点を保つ', () => {
  const pts = K.parsePath('M10,20c5,0,10,5,15,10');
  assert.deepStrictEqual(pts[0], { x: 10, y: 20 });
  const last = pts[pts.length - 1];
  assert.ok(Math.abs(last.x - 25) < 1e-6 && Math.abs(last.y - 30) < 1e-6);
  assert.ok(pts.length > 4, '曲線が分割されている');
});

test('パス解析は S / L / 絶対座標にも対応する', () => {
  const pts = K.parsePath('M0,0 C10,0,10,10,20,10 S30,20,40,20 L50,20');
  const last = pts[pts.length - 1];
  assert.ok(Math.abs(last.x - 50) < 1e-6 && Math.abs(last.y - 20) < 1e-6);
});

// ============================================================
// 終筆（とめ・はね・はらい）— 手本側
// ============================================================
test('手本の終筆が、書写の指導どおりに判定される', () => {
  const wrong = [];
  for (const ch of Object.keys(EXPECTED_ENDINGS)) {
    model[ch].strokes.forEach((s, i) => {
      const want = EXPECTED_ENDINGS[ch][i];
      if (s.ending !== want) wrong.push(`${ch}${i + 1}画: ${s.ending} (期待 ${want})`);
    });
  }
  assert.deepStrictEqual(wrong, []);
});

test('同じ ㇖ でも、はねる画と「おれ」で止める画を形で見分ける', () => {
  // 「字」3画目（宀のはね）と、「子」1画目・「字」4画目（おれ）
  assert.strictEqual(model['字'].strokes[2].ending, 'hane');
  assert.strictEqual(model['字'].strokes[3].ending, 'tome');
  assert.strictEqual(model['子'].strokes[0].ending, 'tome');
});

test('「口」の 2 画目の「おれ」を、はねと取り違えない', () => {
  assert.strictEqual(model['口'].strokes[1].ending, 'tome');
});

// ============================================================
// 点画の交差
// ============================================================
test('手本の点画の関係が正しく求まる', () => {
  const wrong = [];
  for (const ch of Object.keys(EXPECTED_RELATIONS)) {
    for (const [key, want] of Object.entries(EXPECTED_RELATIONS[ch])) {
      const [i, j] = key.split('-').map(Number);
      const rel = model[ch].relations.find(r => r.i === i && r.j === j);
      if (!rel || rel.kind !== want) wrong.push(`${ch} ${key}: ${rel && rel.kind} (期待 ${want})`);
    }
  }
  assert.deepStrictEqual(wrong, []);
});

test('交差・接触・分離を区別する（旧ロジックが取りこぼしていた区別）', () => {
  const rel = K._internal.strokeRelation;
  const line = (x0, y0, x1, y1) => K._internal.resample([{ x: x0, y: y0 }, { x: x1, y: y1 }], 48);
  const yoko = line(0.12, 0.5, 0.88, 0.5);
  assert.strictEqual(rel(yoko, line(0.5, 0.1, 0.5, 0.92)).kind, 'cross', '突き抜けている');
  assert.strictEqual(rel(yoko, line(0.5, 0.1, 0.5, 0.5)).kind, 'touch', '突き当たっている');
  assert.strictEqual(rel(yoko, line(0.5, 0.1, 0.5, 0.3)).kind, 'apart', '離れている');
});

// ============================================================
// 「十」を題材にした総合判定
// ============================================================
/** 正しく書いた「十」 */
const goodJu = () => strokesFrom([
  [[px(0.11), px(0.47)], [px(0.88), px(0.43)]],
  [[px(0.48), px(0.11)], [px(0.50), px(0.91)]],
], { endSlow: 4 });

test('正しく書いた「十」は合格し、どの観点も満点に近い', () => {
  const r = K.judge(goodJu(), model['十'], SIZE);
  assert.ok(r.ok, '合格しない: ' + JSON.stringify(r.messages));
  assert.ok(r.total >= 85, '総合点が低い: ' + r.total);
  assert.strictEqual(r.scores.order, r.maxScores.order);
  assert.strictEqual(r.scores.cross, r.maxScores.cross);
  assert.deepStrictEqual(r.criticals, []);
});

test('縦画が横画を突き抜けていない「十」は不合格になる', () => {
  const strokes = strokesFrom([
    [[px(0.11), px(0.47)], [px(0.88), px(0.43)]],
    [[px(0.48), px(0.11)], [px(0.49), px(0.45)]],   // 横画の手前で止めてしまった
  ]);
  const r = K.judge(strokes, model['十'], SIZE);
  assert.ok(!r.ok, '合格してしまった');
  assert.ok(r.criticals.includes('cross'), '交差の誤りとして扱われていない: ' + r.criticals);
  assert.ok(r.messages.some(m => m.includes('つきぬける') || m.includes('こうさ')), r.messages.join('/'));
});

test('書き順を入れ替えた「十」は不合格になり、書き順の誤りを指摘する', () => {
  const [yoko, tate] = goodJu();
  const r = K.judge([tate, yoko], model['十'], SIZE);
  assert.ok(!r.ok);
  assert.ok(r.criticals.includes('order'));
  assert.strictEqual(r.scores.order, 0);
  // 形そのものは合っているので、字形は落とさない
  assert.ok(r.scores.shape >= r.maxScores.shape * 0.8, '字形まで巻き添えで下がっている: ' + r.scores.shape);
  assert.ok(r.messages.some(m => m.includes('かきじゅん')), r.messages.join('/'));
});

test('横画を右から左へ書くと「向きが逆」と指摘される', () => {
  const [yoko, tate] = goodJu();
  const r = K.judge([yoko.slice().reverse(), tate], model['十'], SIZE);
  assert.ok(!r.ok);
  assert.ok(r.criticals.includes('direction'));
  assert.ok(r.messages.some(m => m.includes('ぎゃく')), r.messages.join('/'));
});

test('画数が足りなければ不合格で、正しい画数を伝える', () => {
  const r = K.judge([goodJu()[0]], model['十'], SIZE);
  assert.ok(!r.ok);
  assert.ok(r.criticals.includes('strokeCount'));
  assert.strictEqual(r.strokeCount.expected, 2);
  assert.strictEqual(r.strokeCount.actual, 1);
  assert.ok(r.messages[0].includes('たりない') || r.messages[0].includes('かくすう'), r.messages.join('/'));
});

test('離れた余分な線を足したら画数の誤りになる', () => {
  const extra = strokesFrom([[[px(0.2), px(0.8)], [px(0.35), px(0.85)]]])[0];
  const r = K.judge([...goodJu(), extra], model['十'], SIZE);
  assert.ok(!r.ok);
  assert.ok(r.criticals.includes('strokeCount'));
});

test('1 画がペンの浮きで 2 つに割れた場合は、つないで採点する', () => {
  const yokoA = strokesFrom([[[px(0.11), px(0.47)], [px(0.48), px(0.45)]]])[0];
  const yokoB = strokesFrom([[[px(0.50), px(0.45)], [px(0.88), px(0.43)]]])[0];
  const tate = goodJu()[1];
  const r = K.judge([yokoA, yokoB, tate], model['十'], SIZE);
  assert.ok(r.strokeCount.repaired, 'つなぎ直しが働いていない');
  assert.ok(r.ok, '合格しない: ' + JSON.stringify(r.messages));
});

// ============================================================
// 字形と配置
// ============================================================
test('形は正しいが小さく書いた字は、字形を保ったまま配置だけ下がる', () => {
  const shrink = goodJu().map(s => s.map(p => ({
    x: SIZE / 2 + (p.x - SIZE / 2) * 0.5,
    y: SIZE / 2 + (p.y - SIZE / 2) * 0.5,
    t: p.t,
  })));
  const r = K.judge(shrink, model['十'], SIZE);
  assert.ok(r.scores.shape >= r.maxScores.shape * 0.8, '字形が巻き添えで下がった: ' + r.scores.shape);
  assert.ok(r.scores.placement < r.maxScores.placement, '配置が減点されていない');
});

test('端点が合っていても途中が曲がっていれば字形で減点される', () => {
  // 旧ロジックは始点と終点しか見ていなかったため、この字を通してしまう
  const bent = strokesFrom([
    [[px(0.11), px(0.47)], [px(0.5), px(0.80)], [px(0.88), px(0.43)]],  // 大きく垂れた横画
    [[px(0.48), px(0.11)], [px(0.50), px(0.91)]],
  ]);
  const r = K.judge(bent, model['十'], SIZE);
  assert.ok(r.scores.shape < r.maxScores.shape * 0.5, '曲がった線が減点されていない: ' + r.scores.shape);
  assert.ok(!r.ok, '曲がった横画が合格してしまった');
});

// ============================================================
// 終筆（児童の線から）
// ============================================================
test('筆の速さから「とめ」と「はらい」を見分ける', () => {
  const line = [[[px(0.3), px(0.2)], [px(0.7), px(0.8)]]];
  const slow = strokesFrom(line, { endSlow: 6 })[0];   // 終わりで筆を止めた
  const fast = strokesFrom(line, { endSlow: 0.4 })[0]; // 速いまま抜いた
  assert.strictEqual(K._internal.detectEnding(norm(slow)).ending, 'tome');
  assert.strictEqual(K._internal.detectEnding(norm(fast)).ending, 'harai');
});

test('はねの有無は形から確実に見分ける', () => {
  const withHook = strokesFrom([[
    [px(0.5), px(0.15)], [px(0.5), px(0.8)], [px(0.4), px(0.74)],
  ]])[0];
  const straight = strokesFrom([[[px(0.5), px(0.15)], [px(0.5), px(0.8)]]])[0];
  assert.strictEqual(K._internal.detectEnding(norm(withHook)).ending, 'hane');
  assert.notStrictEqual(K._internal.detectEnding(norm(straight)).ending, 'hane');
});

test('はねるべき画をはねないと指摘される（小の 1 画目）', () => {
  const r = K.judge(smallKanjiStrokes({ hook: false }), model['小'], SIZE);
  assert.ok(r.messages.some(m => m.includes('はね')), r.messages.join('/'));
  assert.ok(r.scores.ending < r.maxScores.ending);
});

test('はねるべき画をはねれば終筆の減点はない（小の 1 画目）', () => {
  const r = K.judge(smallKanjiStrokes({ hook: true }), model['小'], SIZE);
  assert.ok(!r.messages.some(m => m.includes('はね')), r.messages.join('/'));
});

/** 「小」を書いた筆跡。hook=false のときだけ 1 画目のはねを省く。 */
function smallKanjiStrokes(opts) {
  const tate = opts.hook
    ? [[px(0.52), px(0.17)], [px(0.52), px(0.77)], [px(0.44), px(0.78)]]
    : [[px(0.52), px(0.17)], [px(0.52), px(0.78)]];
  return strokesFrom([
    tate,
    [[px(0.29), px(0.44)], [px(0.16), px(0.67)]],
    [[px(0.74), px(0.43)], [px(0.89), px(0.66)]],
  ], { endSlow: 3 });
}

/** キャンバス座標 → 正規化座標 */
function norm(stroke) {
  return stroke.map(p => ({ x: p.x / SIZE, y: p.y / SIZE, t: p.t }));
}

// ============================================================
// 対応付け
// ============================================================
test('ハンガリー法が最小費用の割り当てを返す', () => {
  const h = K._internal.hungarian;
  assert.deepStrictEqual(h([[1, 9], [9, 1]]), [0, 1]);
  assert.deepStrictEqual(h([[9, 1], [1, 9]]), [1, 0]);
  // 貪欲な最近傍では誤る例（1 行目だけ見ると 0 列が得だが、全体では損）
  assert.deepStrictEqual(h([[3, 4], [1, 9]]), [1, 0]);
});

test('同じ形の画が並ぶ字でも、位置がずれただけで書き順の誤りにしない', () => {
  // 長さの等しい横画 3 本は最も取り違えやすい。
  // 始点の最近傍で貪欲に対応づけると、ここで誤った指摘が出る。
  const line = (x0, y0, x1, y1) => ({ type: '㇐', points: [{ x: x0, y: y0 }, { x: x1, y: y1 }] });
  const m3 = K.buildModel([line(.2, .25, .8, .25), line(.2, .5, .8, .5), line(.2, .75, .8, .75)]);
  const write = (rows) => strokesFrom(rows.map(r => r.map(([x, y]) => [px(x), px(y)])), { endSlow: 4 });

  // 2 画目を 3 画目のすぐ上まで下げても、順番どおりに書けている
  const squeezed = K.judge(write([[[.2, .25], [.8, .25]], [[.2, .70], [.8, .70]], [[.2, .80], [.8, .80]]]), m3, SIZE);
  assert.deepStrictEqual(squeezed.strokes.map(s => s.modelIndex), [0, 1, 2]);
  assert.ok(!squeezed.criticals.includes('order'), squeezed.messages.join('/'));

  // 下から順に書いたときは、きちんと誤りとして拾う
  const upward = K.judge(write([[[.2, .75], [.8, .75]], [[.2, .5], [.8, .5]], [[.2, .25], [.8, .25]]]), m3, SIZE);
  assert.deepStrictEqual(upward.strokes.map(s => s.modelIndex), [2, 1, 0]);
  assert.ok(upward.criticals.includes('order'));
});

test('画数の多い字でも、書き順の入れ替えを正しく突き止める', () => {
  const strokes = writeModel(model['生']);
  const swapped = strokes.slice();
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]];   // 4画目と5画目を逆に書く
  const ok = K.judge(strokes, model['生'], SIZE);
  const ng = K.judge(swapped, model['生'], SIZE);
  assert.ok(ok.ok, '正しく書いた「生」が合格しない: ' + JSON.stringify(ok.messages));
  assert.ok(!ng.ok);
  assert.ok(ng.criticals.includes('order'));
  const wrongPairs = ng.strokes.filter(s => !s.inOrder).map(s => s.userIndex).sort();
  assert.deepStrictEqual(wrongPairs, [3, 4]);
});

/** 手本をなぞって書いた筆跡を作る（お手本どおりの理想的な解答） */
function writeModel(m) {
  return m.strokes.map(s => {
    let t = 0;
    return s.points.map((p, i) => {
      if (i > 0) {
        const q = s.points[i - 1];
        t += Math.hypot(p.x - q.x, p.y - q.y) * SIZE * (i > s.points.length * 0.85 ? 8 : 2);
      }
      return { x: p.x * SIZE, y: p.y * SIZE, t };
    });
  });
}

// ============================================================
// 異常系
// ============================================================
test('何も書いていなければ落ちずに不合格を返す', () => {
  const r = K.judge([], model['十'], SIZE);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.total, 0);
  assert.ok(r.messages.length > 0);
});

test('1 点だけの筆跡でも落ちない', () => {
  const r = K.judge([[{ x: 100, y: 100, t: 0 }]], model['十'], SIZE);
  assert.strictEqual(r.ok, false);
});

test('全部の手本で、なぞり書きが合格する', () => {
  const failed = [];
  for (const ch of Object.keys(RAW)) {
    const r = K.judge(writeModel(model[ch]), model[ch], SIZE);
    if (!r.ok) failed.push(`${ch}: ${r.total}点 ${r.messages.join('/')}`);
  }
  assert.deepStrictEqual(failed, []);
});

// ============================================================
// 指摘の文
// ============================================================
// 数秒しか出ない指摘を児童が読み切れるように、1 行・短文であることを守る。
// 長い説明文に戻すと、読めないまま消えてしまう。
test('指摘の文はどれも短い 1 行になっている', () => {
  const LIMIT = 16;
  const collected = new Set();

  const [yoko, tate] = goodJu();
  const cases = [
    [[tate, yoko], '十'],                        // 書き順
    [[yoko.slice().reverse(), tate], '十'],       // 向きが逆
    [[yoko], '十'],                              // 画数不足
    [strokesFrom([
      [[px(0.11), px(0.47)], [px(0.88), px(0.43)]],
      [[px(0.48), px(0.11)], [px(0.49), px(0.45)]],
    ]), '十'],                                   // 交差
    [[], '十'],                                  // 未記入
  ];
  for (const [strokes, ch] of cases) {
    K.judge(strokes, model[ch], SIZE).messages.forEach(m => collected.add(m));
  }
  for (const ch of Object.keys(RAW)) {
    K.judge(writeModel(model[ch]).slice(1), model[ch], SIZE).messages.forEach(m => collected.add(m));
  }

  assert.ok(collected.size > 0, '指摘が 1 つも集まっていない');
  const tooLong = [...collected].filter(m => m.includes('\n') || m.length > LIMIT);
  assert.deepStrictEqual(tooLong, [], `${LIMIT} 字を超える指摘: ${tooLong.join('/')}`);
});
