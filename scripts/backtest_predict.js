const fs = require("fs");
const path = require("path");

const inputPath =
  process.argv[2] || path.join(__dirname, "..", "data", "mega_sena_astro.json");
const outputPath =
  process.argv[3] ||
  path.join(__dirname, "..", "data", "backtest_results.json");

const configPath = path.join(__dirname, "..", "config", "predictor.json");
let fileConfig = {};
if (fs.existsSync(configPath)) {
  fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
}

const windowSize = Number(process.env.WINDOW || fileConfig.windowSize || 200);
const ticketsPerDraw = Number(
  process.env.TICKETS || fileConfig.ticketsPerDraw || 10
);
const halfLife = Number(process.env.HALF_LIFE || fileConfig.halfLife || 20);
const explore = Number(process.env.EXPLORE || fileConfig.explore || 0.1);
const minHistory = Number(
  process.env.MIN_HISTORY || fileConfig.minHistory || 50
);
const seed = Number(process.env.SEED || fileConfig.seed || 42);
const coldWindow = Number(
  process.env.COLD_WINDOW || fileConfig.coldWindow || 25
);
const hotBoost = Number(process.env.HOT_BOOST || fileConfig.hotBoost || 0.05);
const coldBoost = Number(process.env.COLD_BOOST || fileConfig.coldBoost || 0.1);

if (!fs.existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const draws = JSON.parse(raw);

function rngFactory(seedValue) {
  let state = seedValue >>> 0;
  return function rng() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function weightedSample(numbers, weights, k, rng) {
  const poolNums = numbers.slice();
  const poolW = weights.slice();
  const picked = [];
  for (let i = 0; i < k && poolNums.length > 0; i += 1) {
    const total = poolW.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let idx = 0;
    while (idx < poolW.length) {
      r -= poolW[idx];
      if (r <= 0) break;
      idx += 1;
    }
    const chosenIdx = Math.min(idx, poolNums.length - 1);
    picked.push(poolNums[chosenIdx]);
    poolNums.splice(chosenIdx, 1);
    poolW.splice(chosenIdx, 1);
  }
  return picked.sort((a, b) => a - b);
}

function buildWindow(drawsList, endIdx, size) {
  const start = Math.max(0, endIdx - size);
  return drawsList.slice(start, endIdx);
}

function numbersFromDraw(draw) {
  return [
    draw.bola1,
    draw.bola2,
    draw.bola3,
    draw.bola4,
    draw.bola5,
    draw.bola6,
  ].map(Number);
}

function componentWeights(window, target) {
  const base = Array(61).fill(0);
  const freq = Array(61).fill(0);
  const recency = Array(61).fill(0);
  const astro = Array(61).fill(0);

  const phase = target?.astro?.lunar_phase?.name || null;
  const moonSign = target?.astro?.bodies?.moon?.sign?.label || null;
  const sunSign = target?.astro?.bodies?.sun?.sign?.label || null;
  const dominantElement = target?.astro?.dominant?.element || null;
  const weekday = target?.astro?.numerology?.weekday_index ?? null;
  const dateRoot = target?.astro?.numerology?.date_digital_root ?? null;
  const concursoRoot = target?.astro?.numerology?.concurso_digital_root ?? null;

  for (let i = 0; i < window.length; i += 1) {
    const w = window[i];
    const nums = numbersFromDraw(w);
    const age = window.length - i;
    const decay = Math.exp(-age / halfLife);

    for (const n of nums) {
      freq[n] += 1;
      recency[n] += decay;
    }

    const wPhase = w?.astro?.lunar_phase?.name || null;
    const wMoonSign = w?.astro?.bodies?.moon?.sign?.label || null;
    const wSunSign = w?.astro?.bodies?.sun?.sign?.label || null;
    const wDominant = w?.astro?.dominant?.element || null;
    const wWeekday = w?.astro?.numerology?.weekday_index ?? null;
    const wDateRoot = w?.astro?.numerology?.date_digital_root ?? null;
    const wConcursoRoot = w?.astro?.numerology?.concurso_digital_root ?? null;

    let simScore = 0;
    if (phase && wPhase === phase) simScore += 1;
    if (moonSign && wMoonSign === moonSign) simScore += 1;
    if (sunSign && wSunSign === sunSign) simScore += 1;
    if (dominantElement && wDominant === dominantElement) simScore += 1;
    if (weekday != null && wWeekday === weekday) simScore += 1;
    if (dateRoot != null && wDateRoot === dateRoot) simScore += 1;
    if (concursoRoot != null && wConcursoRoot === concursoRoot) simScore += 1;

    if (simScore > 0) {
      for (const n of nums) {
        astro[n] += simScore;
      }
    }
  }

  for (let i = 1; i <= 60; i += 1) {
    base[i] = 1;
  }

  return { base, freq, recency, astro };
}

function topSixHits(weights, actual) {
  const scored = [];
  for (let i = 1; i <= 60; i += 1) scored.push([i, weights[i]]);
  scored.sort((a, b) => b[1] - a[1]);
  const top = new Set(scored.slice(0, 6).map((v) => v[0]));
  let hits = 0;
  for (const n of actual) if (top.has(n)) hits += 1;
  return hits;
}

function normalizeWeights(weights) {
  const out = weights.slice();
  const total = out.reduce((a, b) => a + b, 0);
  if (!total) return out.map(() => 1);
  return out.map((w) => w / total);
}

function hotColdSets(window, lookback) {
  const recent = window.slice(-lookback);
  const recentSet = new Set();
  for (const d of recent) {
    for (const n of numbersFromDraw(d)) recentSet.add(n);
  }
  const cold = [];
  const hot = Array.from(recentSet).sort((a, b) => a - b);
  for (let n = 1; n <= 60; n += 1) {
    if (!recentSet.has(n)) cold.push(n);
  }
  return { hot, cold };
}

function ticketEntropy(ticket) {
  const bins = [0, 0, 0, 0, 0, 0];
  for (const n of ticket) {
    const idx = Math.min(5, Math.floor((n - 1) / 10));
    bins[idx] += 1;
  }
  let entropy = 0;
  for (const c of bins) {
    if (c === 0) continue;
    const p = c / 6;
    entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(3));
}

const rng = rngFactory(seed);
const results = [];
let score = { freq: 1, recency: 1, astro: 1 };

for (let i = 0; i < draws.length; i += 1) {
  if (i < minHistory) continue;

  const window = buildWindow(draws, i, windowSize);
  const target = draws[i];
  const actual = numbersFromDraw(target);
  const comps = componentWeights(window, target);

  const hitFreq = topSixHits(comps.freq, actual);
  const hitRecency = topSixHits(comps.recency, actual);
  const hitAstro = topSixHits(comps.astro, actual);

  score = {
    freq: score.freq * 0.9 + hitFreq,
    recency: score.recency * 0.9 + hitRecency,
    astro: score.astro * 0.9 + hitAstro,
  };

  const scoreSum = score.freq + score.recency + score.astro;
  const coeff = {
    freq: score.freq / scoreSum,
    recency: score.recency / scoreSum,
    astro: score.astro / scoreSum,
  };

  const mixed = Array(61).fill(0);
  for (let n = 1; n <= 60; n += 1) {
    const w =
      comps.freq[n] * coeff.freq +
      comps.recency[n] * coeff.recency +
      comps.astro[n] * coeff.astro;
    mixed[n] = w;
  }

  const uniform = normalizeWeights(comps.base);
  const mixedNorm = normalizeWeights(mixed);
  const blended = mixedNorm.map(
    (w, idx) => w * (1 - explore) + uniform[idx] * explore
  );

  const numbers = [];
  for (let n = 1; n <= 60; n += 1) numbers.push(n);

  const hotCold = hotColdSets(window, coldWindow);
  const finalWeights = blended.slice();
  for (const n of hotCold.hot) finalWeights[n] *= 1 + hotBoost;
  for (const n of hotCold.cold) finalWeights[n] *= 1 + coldBoost;
  const finalNormalized = normalizeWeights(finalWeights);

  const tickets = [];
  const hits = [];
  const entropies = [];
  for (let t = 0; t < ticketsPerDraw; t += 1) {
    const pick = weightedSample(numbers, finalNormalized, 6, rng);
    tickets.push(pick);
    let h = 0;
    for (const n of pick) if (actual.includes(n)) h += 1;
    hits.push(h);
    entropies.push(ticketEntropy(pick));
  }

  const bestHits = Math.max(...hits);
  const avgHits =
    hits.reduce((sum, v) => sum + v, 0) / (hits.length || 1);

  results.push({
    concurso: target.concurso,
    data_sorteio: target.data_sorteio,
    actual,
    hot_numbers: hotCold.hot,
    cold_numbers: hotCold.cold,
    tickets,
    hits,
    entropies,
    best_hits: bestHits,
    avg_hits: Number(avgHits.toFixed(3)),
    coeff,
  });
}

const summary = {
  windowSize,
  ticketsPerDraw,
  halfLife,
  explore,
  minHistory,
  totalDraws: results.length,
  avgBestHits:
    results.reduce((s, r) => s + r.best_hits, 0) / (results.length || 1),
  avgAvgHits:
    results.reduce((s, r) => s + r.avg_hits, 0) / (results.length || 1),
};

fs.writeFileSync(outputPath, JSON.stringify({ summary, results }, null, 2));
console.log(`Wrote ${outputPath}`);
