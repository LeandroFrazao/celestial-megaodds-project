# Project Lottery

This project builds an experimental pipeline for Mega-Sena draws:
1) Parse draw history
2) Compute astrology features (local, no API)
3) Run a backtest predictor with adjustable weights
4) Tune weights via walk-forward optimization

Note: Mega-Sena is designed to be random. The predictor is for exploration only.

## Quick start

1) Extract draw history (from the Excel file):

```
powershell -ExecutionPolicy Bypass -File .\scripts\extract_megasena.ps1
```

2) Compute astrology features:

```
node .\scripts\compute_astro.js
```

3) Run backtest:

```
node .\scripts\backtest_predict.js
```

Outputs:
- `data/mega_sena.csv`
- `data/mega_sena.json`
- `data/mega_sena_astro.json`
- `data/backtest_results.json`

## Predictor config (detailed)

The predictor reads defaults from `config/predictor.json`. Environment variables
override any field, so you can test changes without editing the file.

### Config file

Path: `config/predictor.json`

```
{
  "windowSize": 200,
  "halfLife": 20,
  "explore": 0.1,
  "hotBoost": 0.05,
  "coldBoost": 0.1,
  "coldWindow": 25,
  "ticketsPerDraw": 10,
  "minHistory": 50,
  "seed": 42
}
```

### Fields

- `windowSize`: How many previous draws are used to compute weights.
  Larger values smooth noise but can lag shifts.
- `halfLife`: Recency decay in draws. Smaller values prioritize recent draws.
- `explore`: Mixes in a uniform distribution (0.0 = no exploration).
- `hotBoost`: Multiplier for numbers recently drawn (see `coldWindow`).
- `coldBoost`: Multiplier for numbers NOT drawn recently (see `coldWindow`).
- `coldWindow`: Number of latest draws used to define hot/cold numbers.
- `ticketsPerDraw`: Number of predicted tickets per draw (backtest only).
- `minHistory`: Minimum history before prediction starts.
- `seed`: RNG seed for reproducible backtest results.

### Environment overrides

Any of these can be set as environment variables:

- `WINDOW`
- `HALF_LIFE`
- `EXPLORE`
- `HOT_BOOST`
- `COLD_BOOST`
- `COLD_WINDOW`
- `TICKETS`
- `MIN_HISTORY`
- `SEED`

Example (PowerShell):

```
$env:WINDOW='120'
$env:HALF_LIFE='12'
$env:EXPLORE='0.18'
node .\scripts\backtest_predict.js
```

## Tuning

The tuner runs walk-forward evaluation without peeking at future draws.

```
node .\scripts\tune_predictor.js
```

For full coverage, the tuning can be split into chunks and merged:

```
$env:STRIDE='1'; $env:RANDOM_TRIALS='20'; $env:START_IDX='50'; $env:END_IDX='800'
node .\scripts\tune_predictor.js .\data\mega_sena_astro.json .\data\tuning_chunk_1.json .\data\tuning_chunk_1.csv

$env:STRIDE='1'; $env:RANDOM_TRIALS='20'; $env:START_IDX='800'; $env:END_IDX='1550'
node .\scripts\tune_predictor.js .\data\mega_sena_astro.json .\data\tuning_chunk_2.json .\data\tuning_chunk_2.csv

$env:STRIDE='1'; $env:RANDOM_TRIALS='20'; $env:START_IDX='1550'; $env:END_IDX='2300'
node .\scripts\tune_predictor.js .\data\mega_sena_astro.json .\data\tuning_chunk_3.json .\data\tuning_chunk_3.csv

$env:STRIDE='1'; $env:RANDOM_TRIALS='20'; $env:START_IDX='2300'; $env:END_IDX='2954'
node .\scripts\tune_predictor.js .\data\mega_sena_astro.json .\data\tuning_chunk_4.json .\data\tuning_chunk_4.csv
```

Merge and report:

```
node .\scripts\merge_tuning_chunks.js .\data .\data\tuning_results_full.json .\data\tuning_results_full.csv
node .\scripts\report_tuning.js .\data\tuning_results_full.json .\data\tuning_report_full.html
```

## Notes

- The astrology calculations use `circular-natal-horoscope-js`.
- Lunar phases include phase name, angle, and illumination.
- The predictor is experimental and not intended for real-world betting.
