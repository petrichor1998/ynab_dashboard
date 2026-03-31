# Model And Assumptions

This document describes the detailed forecasting logic used by the dashboard.

## Purpose

The app is designed as a conservative planning tool, not just a historical report.

It tries to answer:

1. How much realistic monthly room is left for goals?
2. Which goals are safe under the full monthly plan?
3. What happens if a large purchase is added?
4. If the plan is short, where should cuts come from?

## Data Model

The app reads from the YNAB API and builds a normalized payload that includes:

- budget or plan metadata
- category metadata
- target information
- dated goals
- recurring targets
- monthly spending snapshots
- monthly income snapshots

Two different month sets matter:

- `monthlySnapshots`: the shorter forecasting window used by the main dashboard
- `trendSnapshots`: the longer historical window used by the category trends page

## Category Buckets

Non-goal categories are split into four planning buckets:

- `essential`: protected first
- `flexible`: discretionary spending that competes with goals
- `wealth`: saving or investing habits that also compete with goals
- `ignore`: excluded from planning math

Bucket assignments are suggested automatically from category names, then can be changed in the UI.

## Income Logic

Historical income is estimated from recurring inflow candidates.

Excluded by default:

- starting balances
- reconciliation adjustments
- one-off refunds
- reimbursements
- similar non-recurring inflows

The model uses a weighted average over complete months only.

Formula:

`weightedAverage = sum(monthValue * monthWeight) / sum(weights)`

With 3 complete months:

- oldest month weight = `1`
- middle month weight = `2`
- newest month weight = `3`

Manual forecast income overrides the historical baseline:

`avgIncome = manualForecastedIncome ?? historicalAvgIncome`

## Essential Spending

Essential spending has two modes.

### Target mode

For each essential category:

`planningAmount = categoryTarget ?? averageMonthlySpend`

Then:

`targetProtectedSpending = sum(planningAmount for essential categories)`

And:

`avgProtectedSpending = targetProtectedSpending`

### Average mode

For each month:

`monthlyEssentialSpending = sum(essential category spending)`

Then:

`baselineProtectedSpending = weightedAverage(monthlyEssentialSpending)`

And:

`avgProtectedSpending = baselineProtectedSpending`

## Flexible Spending

Flexible spending also has two modes.

### Target mode

`targetFlexibleSpending = sum(targetAmountForPlanning for flexible categories)`

If the user enters a manual flexible target:

`adjustedFlexibleSpending = manualFlexibleTarget ?? targetFlexibleSpending`

Then:

`conservativeFlexibleSpending = max(adjustedFlexibleSpending, targetFlexibleSpending)`

### Average mode

`baselineFlexibleSpending = average(monthlyFlexibleSpending)`

`worstFlexibleSpending = max(monthlyFlexibleSpending)`

Then:

`conservativeFlexibleSpending = max(adjustedFlexibleSpending, worstFlexibleSpending)`

## Wealth Spending

Wealth is treated as planned saving or investing, not behavioral spending.

Default:

`targetWealthBuildingSpending = sum(targetAmountForPlanning for wealth categories)`

With manual override:

`adjustedWealthBuildingSpending = manualWealthTarget ?? targetWealthBuildingSpending`

Then:

`conservativeWealthBuildingSpending = max(adjustedWealthBuildingSpending, targetWealthBuildingSpending)`

## Free Cash Flow

`freeCashFlow = avgIncome - avgProtectedSpending`

This is the monthly room after essential obligations are covered.

## Shared Goal Pool

Goals do not each get the full leftover income. They share one pool.

`totalAvailableForGoalsUnderFullPlan = freeCashFlow - conservativeFlexibleSpending - conservativeWealthBuildingSpending`

This is the main “monthly room considering other goals” idea.

## Dated Goal Math

For each dated goal:

`amountRemaining = max(0, targetAmount - currentAvailable)`

`actualMonthsRemaining = monthsUntilDue(goalDueDate)`

`planningMonths = manualMonthsToAchieve ?? actualMonthsRemaining`

`requiredMonthlyContribution = amountRemaining / planningMonths`

`plannedMonthlyContribution = manualPlannedContribution ?? requiredMonthlyContribution`

## Exact Due Date And Income Timing

The app also uses the exact due date together with the selected income-arrival timing.

Income timing options:

- `first`
- `last`
- `custom day`

The app counts how many income arrivals occur on or before the goal due date and uses that as the default planning window when relevant.

If the user overrides `Income arrivals to achieve`, that manual value replaces the automatically counted window.

## Goal Priority And Funding Order

Goals are funded from the shared goal pool in this order:

1. lower priority number first
2. earlier due date next
3. higher required monthly contribution next

Each goal gets up to its planned monthly contribution until the pool runs out.

`fundedThisMonth = min(plannedMonthlyContribution, remainingGoalPool)`

Then:

`gapThisMonth = max(0, requiredMonthlyContribution - fundedThisMonth)`

## Goal Status

Statuses are based on the full monthly plan.

Rules:

- `Off track` if `freeCashFlow <= 0`
- `At risk` if `fundedThisMonth < requiredMonthlyContribution`
- `On track` otherwise

## Monthly Buffer

`monthlyBufferAfterGoals = freeCashFlow - totalPlannedForGoals - conservativeFlexibleSpending - conservativeWealthBuildingSpending`

Interpretation:

- positive: room remains after current assumptions
- negative: the plan is oversubscribed

## Purchase Stress Test

`scenarioRemainingBuffer = monthlyBufferAfterGoals - purchaseAmount`

The app also recomputes a stressed goal pool:

`scenarioGoalPool = max(0, totalAvailableForGoalsUnderFullPlan - purchaseAmount)`

Then goals are reallocated in priority order to show which ones slip first.

## Cut Suggestions

If the plan is short:

`goalShortfall = max(0, totalRequiredForGoals - totalAvailableForGoalsUnderFullPlan)`

`bufferGap = max(0, -monthlyBufferAfterGoals)`

`overallShortfall = max(goalShortfall, bufferGap)`

Suggested cuts are ordered:

1. flexible first
2. wealth second if needed

Within each bucket, categories are ranked by current modeled level.

## Trend Page Design

The per-category trends page is meant for review, not forecasting directly.

It shows:

- planning target
- recent trend line
- average spend
- latest month
- gap versus target

Supported trend ranges:

- `3m`
- `6m`
- `12m`
- `24m`
- `All time`

`All time` uses the full available month history from the YNAB plan up to the last complete month.

## Important Assumptions

- only complete months are used in averages
- the current partial month is excluded from history calculations
- recurring monthly targets are treated differently from dated goals
- internal and reimbursement-style categories are excluded from planning math by default
- bucket assignments are suggestions, not truth, and should be reviewed by the user
- manual sandbox inputs are allowed to override key assumptions when the user wants a different planning scenario
