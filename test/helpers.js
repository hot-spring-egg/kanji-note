// index.html に埋め込まれている判定エンジンを取り出して読み込む。
// 実際に配信されるコードそのものを試験するため、エンジンの写しは持たない。
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, '..', 'index.html');
const START = '// ==== KANJI_JUDGE_ENGINE_START ====';
const END = '// ==== KANJI_JUDGE_ENGINE_END ====';

function loadEngine() {
  const html = fs.readFileSync(HTML, 'utf8');
  const from = html.indexOf(START);
  const to = html.indexOf(END);
  if (from < 0 || to < 0) throw new Error('index.html に判定エンジンの目印が見つかりません');
  const source = html.slice(from, to + END.length);
  // vm.createContext だと別レルムになり、返る配列の prototype が試験側と食い違う。
  // 同じレルムで評価して deepStrictEqual をそのまま使えるようにする。
  return new Function(source + '\n;return KanjiJudge;')();
}

/**
 * 手書きの筆跡を作る。
 * @param {Array<Array<[number,number]>>} strokes 頂点（キャンバス座標）
 * @param {object} [opts]
 * @param {number} [opts.perPoint] 各サンプル点の間隔(px)
 * @param {number} [opts.speed] 1px あたりのミリ秒（大きいほどゆっくり）
 * @param {number} [opts.endSlow] 末尾 15% を何倍ゆっくり書くか（とめ=大きい値）
 */
function strokesFrom(strokes, opts) {
  const o = Object.assign({ perPoint: 4, speed: 2, endSlow: 1 }, opts);
  return strokes.map(vertices => {
    const pts = [];
    let t = 0;
    // まず等間隔に並べる
    const raw = [];
    for (let i = 1; i < vertices.length; i++) {
      const [x0, y0] = vertices[i - 1];
      const [x1, y1] = vertices[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.round(len / o.perPoint));
      for (let k = (i === 1 ? 0 : 1); k <= n; k++) {
        raw.push({ x: x0 + (x1 - x0) * k / n, y: y0 + (y1 - y0) * k / n });
      }
    }
    // 末尾 15% だけ速度を変えて時刻を振る
    const tailFrom = Math.floor(raw.length * 0.85);
    for (let i = 0; i < raw.length; i++) {
      if (i > 0) {
        const step = Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
        t += step * o.speed * (i >= tailFrom ? o.endSlow : 1);
      }
      pts.push({ x: raw[i].x, y: raw[i].y, t });
    }
    return pts;
  });
}

module.exports = { loadEngine, strokesFrom };
