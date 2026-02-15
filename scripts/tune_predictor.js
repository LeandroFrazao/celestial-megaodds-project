const fs = require("fs");
const path = require("path");

const inputPath =
  process.argv[2] || path.join(__dirname, "..", "data", "mega_sena_astro.json");
const outputPath =
  process.argv[3] || path.join(__dirname, "..", "data", "tuning_results.json");
const outputCsv =
  process.argv[4] || path.join(__dirname, "..", "data", "tuning_results.csv");

const ticketsPerDraw = Number(process.env.TICKETS || 10);
const minHistory = Number(process.env.MIN_HISTORY || 50);
const stride = Number(process.env.STRIDE || 1);
const seedBase = Number(process.env.SEED || 12345);
const randomTrials = Number(process.env.RANDOM_TRIALS || 20);
const startIdx = Number(process.env.START_IDX || minHistory);
const endIdx = Number(process.env.END_IDX || draws.length);

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

function buildWindow(drawsList, endIdx, size) {
  const start = Math.max(0, endIdx - size);
  return drawsList.slice(start, endIdx);
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

function componentWeights(window, target, halfLife) {
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

  for (let i = 1; i <= 60; i += 1) base[i] = 1;

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

function evaluate(params) {
  const rng = rngFactory(seedBase + params.seedOffset);
  let score = { freq: 1, recency: 1, astro: 1 };
  let bestSum = 0;
  let avgSum = 0;
  let count = 0;
  let atLeast2 = 0;
  let atLeast3 = 0;

  const loopStart = Math.max(minHistory, startIdx);
  const loopEnd = Math.min(draws.length, endIdx);
  for (let i = loopStart; i < loopEnd; i += stride) {
    const window = buildWindow(draws, i, params.windowSize);
    const target = draws[i];
    const actual = numbersFromDraw(target);
    const comps = componentWeights(window, target, params.halfLife);

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
      mixed[n] =
        comps.freq[n] * coeff.freq +
        comps.recency[n] * coeff.recency +
        comps.astro[n] * coeff.astro;
    }

    const uniform = normalizeWeights(comps.base);
    const mixedNorm = normalizeWeights(mixed);
    const blended = mixedNorm.map(
      (w, idx) => w * (1 - params.explore) + uniform[idx] * params.explore
    );

    const numbers = [];
    for (let n = 1; n <= 60; n += 1) numbers.push(n);
    const hotCold = hotColdSets(window, params.coldWindow);
    const finalWeights = blended.slice();
    for (const n of hotCold.hot) finalWeights[n] *= 1 + params.hotBoost;
    for (const n of hotCold.cold) finalWeights[n] *= 1 + params.coldBoost;
    const finalNormalized = normalizeWeights(finalWeights);

    let bestHits = 0;
    let sumHits = 0;
    for (let t = 0; t < ticketsPerDraw; t += 1) {
      const pick = weightedSample(numbers, finalNormalized, 6, rng);
      let h = 0;
      for (const n of pick) if (actual.includes(n)) h += 1;
      if (h > bestHits) bestHits = h;
      sumHits += h;
    }

    const avgHits = sumHits / ticketsPerDraw;
    bestSum += bestHits;
    avgSum += avgHits;
    count += 1;
    if (bestHits >= 2) atLeast2 += 1;
    if (bestHits >= 3) atLeast3 += 1;
  }

  return {
    params,
    avgBestHits: bestSum / count,
    avgAvgHits: avgSum / count,
    pctAtLeast2: atLeast2 / count,
    pctAtLeast3: atLeast3 / count,
    bestSum,
    avgSum,
    count,
    atLeast2,
    atLeast3,
  };
}

function gridSearch() {
  const windows = [80, 120, 200];
  const halfLives = [10, 20, 30];
  const explores = [0.1, 0.2];
  const hotBoosts = [0.05, 0.1];
  const coldBoosts = [0.1, 0.2];
  const coldWindows = [15, 25];
  const results = [];
  let offset = 0;
  for (const windowSize of windows) {
    for (const halfLife of halfLives) {
      for (const explore of explores) {
        for (const hotBoost of hotBoosts) {
          for (const coldBoost of coldBoosts) {
            for (const coldWindow of coldWindows) {
              results.push(
                evaluate({
                  windowSize,
                  halfLife,
                  explore,
                  hotBoost,
                  coldBoost,
                  coldWindow,
                  seedOffset: offset++,
                })
              );
            }
          }
        }
      }
    }
  }
  return results;
}

function candidateRuns() {
  const candidates = [
    {
      name: "default",
      windowSize: 100,
      halfLife: 20,
      explore: 0.15,
      hotBoost: 0.1,
      coldBoost: 0.2,
      coldWindow: 20,
    },
    {
      name: "low_explore",
      windowSize: 120,
      halfLife: 20,
      explore: 0.08,
      hotBoost: 0.1,
      coldBoost: 0.18,
      coldWindow: 20,
    },
    {
      name: "large_window",
      windowSize: 220,
      halfLife: 25,
      explore: 0.12,
      hotBoost: 0.08,
      coldBoost: 0.18,
      coldWindow: 25,
    },
    {
      name: "fast_decay",
      windowSize: 100,
      halfLife: 12,
      explore: 0.18,
      hotBoost: 0.12,
      coldBoost: 0.2,
      coldWindow: 15,
    },
    {
      name: "cold_bias",
      windowSize: 120,
      halfLife: 20,
      explore: 0.12,
      hotBoost: 0.05,
      coldBoost: 0.3,
      coldWindow: 25,
    },
  ];

  return candidates.map((c, idx) => {
    const result = evaluate({ ...c, seedOffset: 1000 + idx });
    return { name: c.name, ...result };
  });
}

function randomSearch() {
  const results = [];
  for (let i = 0; i < randomTrials; i += 1) {
    const windowSize = 60 + Math.floor(Math.random() * 200);
    const halfLife = 8 + Math.floor(Math.random() * 30);
    const explore = Number((0.05 + Math.random() * 0.25).toFixed(3));
    const hotBoost = Number((0.03 + Math.random() * 0.15).toFixed(3));
    const coldBoost = Number((0.05 + Math.random() * 0.3).toFixed(3));
    const coldWindow = 10 + Math.floor(Math.random() * 30);
    results.push(
      evaluate({
        windowSize,
        halfLife,
        explore,
        hotBoost,
        coldBoost,
        coldWindow,
        seedOffset: 2000 + i,
      })
    );
  }
  return results;
}

function sortResults(list) {
  return list.sort((a, b) => {
    if (b.avgBestHits !== a.avgBestHits) {
      return b.avgBestHits - a.avgBestHits;
    }
    return b.avgAvgHits - a.avgAvgHits;
  });
}

const grid = sortResults(gridSearch());
const candidates = sortResults(candidateRuns());
const random = sortResults(randomSearch());

const output = {
  summary: {
    draws: draws.length,
    minHistory,
    ticketsPerDraw,
    stride,
    randomTrials,
    startIdx,
    endIdx,
  },
  grid,
  candidates,
  random,
};

const rows = [
  [
    "group",
    "name",
    "windowSize",
    "halfLife",
    "explore",
    "hotBoost",
    "coldBoost",
    "coldWindow",
    "avgBestHits",
    "avgAvgHits",
    "pctAtLeast2",
    "pctAtLeast3",
  ],
];

function addRows(group, list) {
  for (const r of list) {
    const p = r.params || r;
    rows.push([
      group,
      r.name || "",
      p.windowSize,
      p.halfLife,
      p.explore,
      p.hotBoost,
      p.coldBoost,
      p.coldWindow,
      r.avgBestHits.toFixed(4),
      r.avgAvgHits.toFixed(4),
      r.pctAtLeast2.toFixed(4),
      r.pctAtLeast3.toFixed(4),
    ]);
  }
}

addRows("grid", grid);
addRows("candidates", candidates);
addRows("random", random);

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
fs.writeFileSync(outputCsv, rows.map((r) => r.join(",")).join("\n"));

console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${outputCsv}`);
