const fs = require("fs");
const path = require("path");
const { Origin, Horoscope } = require("circular-natal-horoscope-js");

const inputPath =
  process.argv[2] || path.join(__dirname, "..", "data", "mega_sena_astro.json");
const outputPath =
  process.argv[3] ||
  path.join(__dirname, "..", "data", "predictions_megadavirada_2025.json");
const outputCsv =
  process.argv[4] ||
  path.join(__dirname, "..", "data", "predictions_megadavirada_2025.csv");

const configPath = path.join(__dirname, "..", "config", "predictor.json");
let fileConfig = {};
if (fs.existsSync(configPath)) {
  fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
}

const windowSize = Number(process.env.WINDOW || fileConfig.windowSize || 200);
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

const ticketsCount = Number(process.env.TICKETS || 20);

const target = {
  date: "2025-12-31",
  hour: 22,
  minute: 0,
  latitude: -23.564,
  longitude: -46.651,
  timezoneLabel: "America/Sao_Paulo",
};

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

function normalizeWeights(weights) {
  const out = weights.slice();
  const total = out.reduce((a, b) => a + b, 0);
  if (!total) return out.map(() => 1);
  return out.map((w) => w / total);
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

function topSixHits(weights, actual) {
  const scored = [];
  for (let i = 1; i <= 60; i += 1) scored.push([i, weights[i]]);
  scored.sort((a, b) => b[1] - a[1]);
  const top = new Set(scored.slice(0, 6).map((v) => v[0]));
  let hits = 0;
  for (const n of actual) if (top.has(n)) hits += 1;
  return hits;
}

function componentWeights(window, targetAstro) {
  const base = Array(61).fill(0);
  const freq = Array(61).fill(0);
  const recency = Array(61).fill(0);
  const astro = Array(61).fill(0);

  const phase = targetAstro?.lunar_phase?.name || null;
  const moonSign = targetAstro?.bodies?.moon?.sign?.label || null;
  const sunSign = targetAstro?.bodies?.sun?.sign?.label || null;
  const dominantElement = targetAstro?.dominant?.element || null;
  const weekday = targetAstro?.numerology?.weekday_index ?? null;
  const dateRoot = targetAstro?.numerology?.date_digital_root ?? null;
  const concursoRoot = targetAstro?.numerology?.concurso_digital_root ?? null;

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

function computeCoefficients(history) {
  let score = { freq: 1, recency: 1, astro: 1 };
  for (let i = minHistory; i < history.length; i += 1) {
    const window = buildWindow(history, i, windowSize);
    const targetDraw = history[i];
    const actual = numbersFromDraw(targetDraw);
    const comps = componentWeights(window, targetDraw.astro);

    const hitFreq = topSixHits(comps.freq, actual);
    const hitRecency = topSixHits(comps.recency, actual);
    const hitAstro = topSixHits(comps.astro, actual);

    score = {
      freq: score.freq * 0.9 + hitFreq,
      recency: score.recency * 0.9 + hitRecency,
      astro: score.astro * 0.9 + hitAstro,
    };
  }

  const sum = score.freq + score.recency + score.astro;
  return {
    freq: score.freq / sum,
    recency: score.recency / sum,
    astro: score.astro / sum,
  };
}

function computeTargetAstro() {
  const [year, month, day] = target.date.split("-").map(Number);
  const origin = new Origin({
    year,
    month: month - 1,
    date: day,
    hour: target.hour,
    minute: target.minute,
    latitude: target.latitude,
    longitude: target.longitude,
  });

  const horoscope = new Horoscope({
    origin,
    houseSystem: "placidus",
    zodiac: "tropical",
    aspectPoints: ["bodies", "points", "angles"],
    aspectWithPoints: ["bodies", "points", "angles"],
    aspectTypes: ["major"],
    customOrbs: {},
    language: "en",
  });

  const bodies = {};
  for (const key of Object.keys(horoscope.CelestialBodies)) {
    if (key === "all") continue;
    bodies[key] = {
      sign: {
        key: horoscope.CelestialBodies[key].Sign?.key || null,
        label: horoscope.CelestialBodies[key].Sign?.label || null,
      },
      chart: {
        ecliptic_deg:
          horoscope.CelestialBodies[key].ChartPosition?.Ecliptic
            ?.DecimalDegrees ?? null,
      },
    };
  }

  const moonEcl = bodies.moon?.chart?.ecliptic_deg;
  const sunEcl = bodies.sun?.chart?.ecliptic_deg;
  const phaseAngle =
    moonEcl != null && sunEcl != null
      ? ((moonEcl - sunEcl) % 360 + 360) % 360
      : null;

  function moonPhaseFromAngle(angle) {
    if (angle < 22.5) return "New Moon";
    if (angle < 67.5) return "Waxing Crescent";
    if (angle < 112.5) return "First Quarter";
    if (angle < 157.5) return "Waxing Gibbous";
    if (angle < 202.5) return "Full Moon";
    if (angle < 247.5) return "Waning Gibbous";
    if (angle < 292.5) return "Last Quarter";
    if (angle < 337.5) return "Waning Crescent";
    return "New Moon";
  }

  function sumDigits(str) {
    return String(str)
      .replace(/\D/g, "")
      .split("")
      .reduce((sum, d) => sum + Number(d), 0);
  }

  function digitalRoot(value) {
    let n = Math.abs(Number(value));
    while (n >= 10) {
      n = String(n)
        .split("")
        .reduce((s, d) => s + Number(d), 0);
    }
    return n;
  }

  function signElement(signKey) {
    const map = {
      aries: "fire",
      taurus: "earth",
      gemini: "air",
      cancer: "water",
      leo: "fire",
      virgo: "earth",
      libra: "air",
      scorpio: "water",
      sagittarius: "fire",
      capricorn: "earth",
      aquarius: "air",
      pisces: "water",
    };
    return map[signKey] || null;
  }

  const signCounts = {};
  const elementCounts = { fire: 0, earth: 0, air: 0, water: 0 };
  for (const key of Object.keys(bodies)) {
    const signKey = bodies[key]?.sign?.key;
    if (!signKey) continue;
    signCounts[signKey] = (signCounts[signKey] || 0) + 1;
    const element = signElement(signKey);
    if (element) elementCounts[element] += 1;
  }

  let topSign = null;
  let topSignCount = -1;
  for (const [sign, count] of Object.entries(signCounts)) {
    if (count > topSignCount) {
      topSign = sign;
      topSignCount = count;
    }
  }

  let topElement = null;
  let topElementCount = -1;
  for (const [element, count] of Object.entries(elementCounts)) {
    if (count > topElementCount) {
      topElement = element;
      topElementCount = count;
    }
  }

  const dateDigitSum = sumDigits(target.date);
  const weekdayIdx = new Date(`${target.date}T00:00:00Z`).getUTCDay();

  return {
    bodies,
    lunar_phase: {
      angle_deg: phaseAngle,
      illumination:
        phaseAngle != null ? (1 - Math.cos((Math.PI / 180) * phaseAngle)) / 2 : null,
      name: phaseAngle != null ? moonPhaseFromAngle(phaseAngle) : null,
    },
    dominant: {
      sign: topSign,
      sign_count: topSignCount < 0 ? 0 : topSignCount,
      element: topElement,
      element_count: topElementCount < 0 ? 0 : topElementCount,
    },
    numerology: {
      date_digit_sum: dateDigitSum,
      date_digital_root: digitalRoot(dateDigitSum),
      concurso_digital_root: null,
      weekday_index: weekdayIdx,
    },
  };
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

const history = draws.slice();
const coeff = computeCoefficients(history);
const targetAstro = computeTargetAstro();
const historyWindow = buildWindow(history, history.length, windowSize);
const comps = componentWeights(historyWindow, targetAstro);

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
  (w, idx) => w * (1 - explore) + uniform[idx] * explore
);

const numbers = [];
for (let n = 1; n <= 60; n += 1) numbers.push(n);
const hotCold = hotColdSets(historyWindow, coldWindow);
const finalWeights = blended.slice();
for (const n of hotCold.hot) finalWeights[n] *= 1 + hotBoost;
for (const n of hotCold.cold) finalWeights[n] *= 1 + coldBoost;
const finalNormalized = normalizeWeights(finalWeights);

const rng = rngFactory(seed);
const tickets = [];
const entropies = [];
for (let t = 0; t < ticketsCount; t += 1) {
  const pick = weightedSample(numbers, finalNormalized, 6, rng);
  tickets.push(pick);
  entropies.push(ticketEntropy(pick));
}

const output = {
  target,
  config: {
    windowSize,
    halfLife,
    explore,
    hotBoost,
    coldBoost,
    coldWindow,
    ticketsCount,
    minHistory,
  },
  coeff,
  astro: targetAstro,
  hot_numbers: hotCold.hot,
  cold_numbers: hotCold.cold,
  tickets,
  entropies,
};

const csvRows = [
  ["ticket", "n1", "n2", "n3", "n4", "n5", "n6", "entropy"],
];
for (let i = 0; i < tickets.length; i += 1) {
  csvRows.push([String(i + 1), ...tickets[i].map(String), String(entropies[i])]);
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
fs.writeFileSync(outputCsv, csvRows.map((r) => r.join(",")).join("\n"));

console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${outputCsv}`);
