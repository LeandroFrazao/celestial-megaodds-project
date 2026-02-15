const fs = require("fs");
const path = require("path");

const inputPath =
  process.argv[2] || path.join(__dirname, "..", "data", "tuning_results.json");
const outputPath =
  process.argv[3] || path.join(__dirname, "..", "data", "tuning_report.html");

if (!fs.existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const data = JSON.parse(raw);

function topN(list, n) {
  return list.slice(0, n);
}

function renderTable(title, list) {
  const rows = list
    .map((r) => {
      const p = r.params || r;
      return `<tr>
  <td>${r.name || ""}</td>
  <td>${p.windowSize}</td>
  <td>${p.halfLife}</td>
  <td>${p.explore}</td>
  <td>${p.hotBoost}</td>
  <td>${p.coldBoost}</td>
  <td>${p.coldWindow}</td>
  <td>${r.avgBestHits.toFixed(4)}</td>
  <td>${r.avgAvgHits.toFixed(4)}</td>
  <td>${r.pctAtLeast2.toFixed(4)}</td>
  <td>${r.pctAtLeast3.toFixed(4)}</td>
</tr>`;
    })
    .join("\n");

  return `
  <div class="card">
    <h2>${title}</h2>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Window</th>
          <th>HalfLife</th>
          <th>Explore</th>
          <th>Hot</th>
          <th>Cold</th>
          <th>ColdWindow</th>
          <th>AvgBest</th>
          <th>AvgAvg</th>
          <th>Pct≥2</th>
          <th>Pct≥3</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tuning Report</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f7f6f2; color: #222; margin: 24px; }
    h1 { margin: 0 0 12px; font-size: 22px; }
    h2 { margin: 0 0 12px; font-size: 16px; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #eee; padding: 6px 4px; text-align: right; }
    th:first-child, td:first-child { text-align: left; }
  </style>
</head>
<body>
  <h1>Top 5 Tuning Results</h1>
  <div class="grid">
    ${renderTable("Grid Search", topN(data.grid, 5))}
    ${renderTable("Candidate Runs", topN(data.candidates, 5))}
    ${renderTable("Random Search", topN(data.random, 5))}
  </div>
  <div class="card">
    <p>Source: ${path.basename(inputPath)}</p>
  </div>
</body>
</html>`;

fs.writeFileSync(outputPath, html);
console.log(`Wrote ${outputPath}`);
