const fs = require("fs");
const path = require("path");

const inputDir = process.argv[2] || path.join(__dirname, "..", "data");
const outputJson =
  process.argv[3] ||
  path.join(__dirname, "..", "data", "tuning_results_full.json");
const outputCsv =
  process.argv[4] ||
  path.join(__dirname, "..", "data", "tuning_results_full.csv");

function findFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("tuning_chunk_") && f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

function keyForResult(r) {
  const p = r.params || r;
  const name = r.name || "";
  return [
    name,
    p.windowSize,
    p.halfLife,
    p.explore,
    p.hotBoost,
    p.coldBoost,
    p.coldWindow,
  ].join("|");
}

function mergeGroup(groupLists) {
  const map = new Map();
  for (const list of groupLists) {
    for (const r of list) {
      const key = keyForResult(r);
      if (!map.has(key)) {
        map.set(key, {
          name: r.name || "",
          params: r.params || r,
          bestSum: 0,
          avgSum: 0,
          count: 0,
          atLeast2: 0,
          atLeast3: 0,
        });
      }
      const item = map.get(key);
      item.bestSum += r.bestSum;
      item.avgSum += r.avgSum;
      item.count += r.count;
      item.atLeast2 += r.atLeast2;
      item.atLeast3 += r.atLeast3;
    }
  }

  const merged = Array.from(map.values()).map((m) => ({
    name: m.name,
    params: m.params,
    avgBestHits: m.bestSum / m.count,
    avgAvgHits: m.avgSum / m.count,
    pctAtLeast2: m.atLeast2 / m.count,
    pctAtLeast3: m.atLeast3 / m.count,
    bestSum: m.bestSum,
    avgSum: m.avgSum,
    count: m.count,
    atLeast2: m.atLeast2,
    atLeast3: m.atLeast3,
  }));

  merged.sort((a, b) => {
    if (b.avgBestHits !== a.avgBestHits) {
      return b.avgBestHits - a.avgBestHits;
    }
    return b.avgAvgHits - a.avgAvgHits;
  });

  return merged;
}

const files = findFiles(inputDir);
if (!files.length) {
  console.error(`No chunk files found in ${inputDir}`);
  process.exit(1);
}

const chunks = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const grid = mergeGroup(chunks.map((c) => c.grid));
const candidates = mergeGroup(chunks.map((c) => c.candidates));
const random = mergeGroup(chunks.map((c) => c.random));

const summary = {
  chunks: files.length,
  inputs: files.map((f) => path.basename(f)),
};

const output = { summary, grid, candidates, random };
fs.writeFileSync(outputJson, JSON.stringify(output, null, 2));

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

fs.writeFileSync(outputCsv, rows.map((r) => r.join(",")).join("\n"));
console.log(`Wrote ${outputJson}`);
console.log(`Wrote ${outputCsv}`);
