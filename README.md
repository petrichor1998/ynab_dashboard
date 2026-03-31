# YNAB Goal Forecast Dashboard

A planning dashboard built on top of the YNAB API.

It helps answer questions like:

- Am I still on track to hit my dated goals?
- How much monthly room do I really have after essentials, flexible spending, and wealth-building?
- If I make a large purchase, which goals slip first?
- If my plan is short, how much should I cut from flexible or wealth categories?

## Screenshots

Screenshots below show the main planning dashboard and the per-category trends view.

![Goal dashboard](docs/dashboard-overview.png)

![Category trends](docs/category-trends.png)

## Key Views

- `Goal dashboard`: full-plan goal pacing, purchase stress testing, bucket assignment, and cut suggestions
- `Category trends`: per-category planning target, recent spending trend, latest month, average spend, and target gap

## How It Works

The app pulls category, goal, and transaction data from the YNAB API and builds a conservative planning model.

Main ideas:

- `essential` categories are protected first
- `flexible` categories compete with goals
- `wealth` categories track savings or investing habits that also compete with goals
- dated goals share one monthly funding pool instead of each assuming they get the full leftover income

The dashboard supports:

- manual forecasted monthly income
- income timing assumptions like first day, last day, or a custom day
- goal priority and custom months-to-achieve
- purchase stress testing
- category-level target overrides
- per-category trend review with multiple time ranges, including `All time`

## Forecast Summary

At a high level, the model uses:

- weighted average income across recent complete months, unless manually overridden
- target-based or average-based assumptions for essential and flexible categories
- target-based assumptions for wealth categories
- exact due dates and income-arrival timing for dated goals

The core question is:

`How much monthly room is left for goals after protected spending, flexible spending, and wealth-building are accounted for?`

## Local Setup

1. Clone the repo.
2. Install dependencies:

```bash
npm install
```

3. Create a local `.env` from `.env.example` and add your own YNAB credentials.
4. Start the app:

```bash
npm start
```

5. Open `http://localhost:8787`.

## Environment Variables

Use `.env.example` as the template.

Required local values:

- `YNAB_ACCESS_TOKEN`
- `YNAB_PLAN_ID`

Optional values:

- `YNAB_MONTHS_TO_ANALYZE`
- `DEFAULT_SCENARIO_AMOUNT`
- `PORT`

## Main Files

- `server.mjs`: pulls and normalizes YNAB data
- `src/lib/forecast.js`: forecasting and planning formulas
- `src/App.jsx`: dashboard UI and sandbox controls
- `src/styles.css`: app styling
- `docs/MODEL_AND_ASSUMPTIONS.md`: detailed formulas, assumptions, and design notes

## Notes

- The app uses complete months only for trend analysis.
- The current partial month is excluded from historical averages.
- Recurring monthly targets are treated differently from dated goals.
- Bucket assignments are suggested automatically, then reviewed and adjusted in the UI.
- Detailed forecasting formulas and assumptions are documented in `docs/MODEL_AND_ASSUMPTIONS.md`.

## Open Source And Collaboration

This repo is public and open to collaboration.

- License: `MIT`
- Safe setup: each user should create their own local `.env`
- Required secrets stay local: `YNAB_ACCESS_TOKEN` and `YNAB_PLAN_ID`

If you want to contribute:

1. Fork the repo or open an issue first for larger changes.
2. Keep any real YNAB tokens, plan IDs, or exported budget payloads out of commits.
3. Use `.env.example` as the template for local setup.
4. Prefer changes that keep the forecasting assumptions transparent and explainable.

