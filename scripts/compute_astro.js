const fs = require("fs");
const path = require("path");
const { Origin, Horoscope } = require("circular-natal-horoscope-js");

const inputPath =
  process.argv[2] || path.join(__dirname, "..", "data", "mega_sena.json");
const outputPath =
  process.argv[3] || path.join(__dirname, "..", "data", "mega_sena_astro.json");

if (!fs.existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, "utf8");
const draws = JSON.parse(raw.replace(/^\uFEFF/, ""));

function mapChartPosition(pos) {
  if (!pos) return null;
  return {
    horizon_deg: pos.Horizon?.DecimalDegrees ?? null,
    ecliptic_deg: pos.Ecliptic?.DecimalDegrees ?? null,
  };
}

function mapSign(sign) {
  if (!sign) return null;
  return {
    key: sign.key,
    label: sign.label,
    zodiac_start: sign.zodiacStart,
    zodiac_end: sign.zodiacEnd,
  };
}

function mapHouse(house) {
  if (!house) return null;
  return {
    id: house.id,
    label: house.label,
    sign: mapSign(house.Sign),
    start: mapChartPosition(house.ChartPosition?.StartPosition),
    end: mapChartPosition(house.ChartPosition?.EndPosition),
  };
}

function mapBody(body) {
  if (!body) return null;
  return {
    key: body.key,
    label: body.label,
    sign: mapSign(body.Sign),
    house: body.House ? { id: body.House.id, label: body.House.label } : null,
    chart: mapChartPosition(body.ChartPosition),
    is_retrograde: body.isRetrograde ?? null,
  };
}

function mapAspect(aspect) {
  return {
    point1: aspect.point1Key,
    point2: aspect.point2Key,
    aspect: aspect.aspectKey,
    level: aspect.aspectLevel,
    orb: aspect.orb,
    orb_used: aspect.orbUsed,
  };
}

function normalizeDegrees(deg) {
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}

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

function illuminationFromAngle(angle) {
  const rad = (Math.PI / 180) * angle;
  return (1 - Math.cos(rad)) / 2;
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

function dominantSignAndElement(bodies) {
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

  return {
    sign: topSign,
    sign_count: topSignCount < 0 ? 0 : topSignCount,
    element: topElement,
    element_count: topElementCount < 0 ? 0 : topElementCount,
  };
}

function aspectSummary(aspects) {
  const counts = {
    conjunction: 0,
    opposition: 0,
    trine: 0,
    square: 0,
    sextile: 0,
    quincunx: 0,
  };
  for (const a of aspects) {
    if (counts[a.aspect] !== undefined) counts[a.aspect] += 1;
  }
  return counts;
}

function moonSunAspect(phaseAngle) {
  if (phaseAngle == null) return null;
  const targets = [
    { name: "conjunction", deg: 0 },
    { name: "sextile", deg: 60 },
    { name: "square", deg: 90 },
    { name: "trine", deg: 120 },
    { name: "opposition", deg: 180 },
    { name: "quincunx", deg: 150 },
  ];
  let best = null;
  let bestDelta = 1e9;
  for (const t of targets) {
    const delta = Math.min(
      Math.abs(phaseAngle - t.deg),
      360 - Math.abs(phaseAngle - t.deg)
    );
    if (delta < bestDelta) {
      bestDelta = delta;
      best = t.name;
    }
  }
  return { aspect: best, orb_deg: Number(bestDelta.toFixed(3)) };
}

const results = [];
for (let i = 0; i < draws.length; i += 1) {
  const draw = draws[i];
  const [year, month, day] = draw.data_sorteio.split("-").map(Number);
  const latitude = Number(draw.latitude) || -23.564;
  const longitude = Number(draw.longitude) || -46.651;

  const origin = new Origin({
    year,
    month: month - 1,
    date: day,
    hour: 21,
    minute: 0,
    latitude,
    longitude,
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
    bodies[key] = mapBody(horoscope.CelestialBodies[key]);
  }

  const points = {};
  for (const key of Object.keys(horoscope.CelestialPoints)) {
    if (key === "all") continue;
    points[key] = mapBody(horoscope.CelestialPoints[key]);
  }

  const angles = {};
  for (const key of Object.keys(horoscope.Angles)) {
    if (key === "all") continue;
    angles[key] = {
      key: horoscope.Angles[key].key,
      label: horoscope.Angles[key].label,
      sign: mapSign(horoscope.Angles[key].Sign),
      chart: mapChartPosition(horoscope.Angles[key].ChartPosition),
    };
  }

  const houses = horoscope.Houses.map(mapHouse);
  const aspects = horoscope.Aspects?.all?.map(mapAspect) || [];
  const sunEcl = bodies.sun?.chart?.ecliptic_deg;
  const moonEcl = bodies.moon?.chart?.ecliptic_deg;
  const phaseAngle =
    sunEcl != null && moonEcl != null
      ? normalizeDegrees(moonEcl - sunEcl)
      : null;
  const illumination =
    phaseAngle != null ? illuminationFromAngle(phaseAngle) : null;
  const phaseName = phaseAngle != null ? moonPhaseFromAngle(phaseAngle) : null;
  const moonSun = moonSunAspect(phaseAngle);
  const dominant = dominantSignAndElement(bodies);
  const aspectsCount = aspectSummary(aspects);
  const weekdayIdx = new Date(`${draw.data_sorteio}T00:00:00Z`).getUTCDay();
  const dateDigitSum = sumDigits(draw.data_sorteio);

  results.push({
    ...draw,
    astro: {
      zodiac: "tropical",
      house_system: "placidus",
      numerology: {
        date_digit_sum: dateDigitSum,
        date_digital_root: digitalRoot(dateDigitSum),
        concurso_digital_root: digitalRoot(draw.concurso),
        weekday_index: weekdayIdx,
      },
      lunar_phase: {
        angle_deg: phaseAngle,
        illumination,
        name: phaseName,
        moon_sun_aspect: moonSun,
      },
      dominant,
      aspects_summary: aspectsCount,
      bodies,
      points,
      angles,
      houses,
      aspects,
    },
  });

  if ((i + 1) % 250 === 0) {
    console.log(`Processed ${i + 1}/${draws.length}`);
  }
}

fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`Wrote ${outputPath}`);
