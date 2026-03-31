import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 8787);
const ynabBaseUrl = "https://api.ynab.com/v1";
const currentDate = new Date();

function moneyFromMilliunits(value) {
  return Math.round((value / 1000) * 100) / 100;
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function isoMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function firstDayOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date, offset) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

function buildMonthWindows(monthsToAnalyze, now = currentDate) {
  const currentMonth = firstDayOfMonth(now);
  const months = [];

  for (let index = monthsToAnalyze; index >= 1; index -= 1) {
    const monthDate = addMonths(currentMonth, -index);
    months.push({
      key: isoMonth(monthDate),
      start: monthDate,
      end: addMonths(monthDate, 1),
    });
  }

  return months;
}

function parseMonthKey(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

function buildMonthWindowsBetween(startMonthKey, endDate = addMonths(firstDayOfMonth(currentDate), -1)) {
  const startDate = parseMonthKey(startMonthKey);
  if (!startDate) return [];

  const months = [];
  let cursor = firstDayOfMonth(startDate);
  const endMonth = firstDayOfMonth(endDate);

  while (cursor <= endMonth) {
    months.push({
      key: isoMonth(cursor),
      start: cursor,
      end: addMonths(cursor, 1),
    });
    cursor = addMonths(cursor, 1);
  }

  return months;
}

function defaultProtectedMatcher(category) {
  const combined = `${category.groupName} ${category.name}`.toLowerCase();
  return /(rent|mortgage|housing|grocer|utility|electric|water|gas bill|internet|phone|insurance|medical|health|transport|fuel|car payment|loan|debt|tax|childcare|subscription|bill|wifi|gym)/i.test(
    combined,
  );
}

function defaultExcludedCategoryMatcher(category) {
  const combined = `${category.groupName} ${category.name}`.toLowerCase();
  return /(internal master category|reimbursements|ready to assign|inflow)/i.test(combined);
}

function defaultWealthMatcher(category) {
  const combined = `${category.groupName} ${category.name}`.toLowerCase();
  return /(investment|invest|robinhood|brokerage|wealth|retirement|savings)/i.test(combined);
}

function defaultFlexibleMatcher(category) {
  const combined = `${category.groupName} ${category.name}`.toLowerCase();
  return /(fun|eating out|doordash|amazon|entertainment|spending|misc|trip|travel|shopping)/i.test(combined);
}

function suggestCategoryBucket(category) {
  if (category.hasGoal) return "goal";
  if (defaultExcludedCategoryMatcher(category)) return "ignore";
  if (defaultProtectedMatcher(category)) return "essential";
  if (defaultWealthMatcher(category)) return "wealth";
  if (defaultFlexibleMatcher(category)) return "flexible";
  return "flexible";
}

function normalizeSubtransactions(transaction) {
  if (Array.isArray(transaction.subtransactions) && transaction.subtransactions.length > 0) {
    return transaction.subtransactions.map((subtransaction) => ({
      ...subtransaction,
      date: transaction.date,
      transfer_account_id: transaction.transfer_account_id,
      payee_name: subtransaction.payee_name ?? transaction.payee_name,
      category_name: subtransaction.category_name ?? transaction.category_name,
      account_name: transaction.account_name,
      memo: subtransaction.memo ?? transaction.memo,
    }));
  }

  return [transaction];
}

function classifyPositiveInflow(transaction) {
  const payeeName = (transaction.payee_name || "").toLowerCase();
  const memo = (transaction.memo || "").toLowerCase();
  const combined = `${payeeName} ${memo}`;

  if (payeeName.includes("starting balance")) return "starting_balance";
  if (payeeName.includes("reconciliation balance adjustment")) return "reconciliation";
  if (/(refund|reimbursement|rewards|cashback|interest|zelle|venmo|paypal|trs refund)/i.test(combined)) {
    return "one_off";
  }
  return "income_candidate";
}

function shouldCountAsIncome(transaction) {
  if (!transaction || transaction.amount <= 0 || transaction.transfer_account_id) {
    return false;
  }

  const categoryName = (transaction.category_name || "").toLowerCase();
  return !transaction.category_id || categoryName.includes("ready to assign") || categoryName.includes("inflow");
}

function isLikelyRecurringIncomePayee(payeeName) {
  return /(salary|stipend|payroll|paycheck|income|direct deposit)/i.test(payeeName || "");
}

async function fetchYnabJson(endpoint) {
  const accessToken = process.env.YNAB_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("Missing YNAB_ACCESS_TOKEN in environment.");
  }

  const response = await fetch(`${ynabBaseUrl}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const payload = await response.json();

  if (!response.ok) {
    const detail = payload?.error?.detail || `YNAB request failed with ${response.status}`;
    throw new Error(detail);
  }

  return payload.data;
}

async function loadPlanSummary(planId) {
  return fetchYnabJson(`/plans/${planId}`);
}

async function loadCategories(planId) {
  return fetchYnabJson(`/plans/${planId}/categories`);
}

async function loadTransactions(planId, sinceDate) {
  const encodedDate = encodeURIComponent(sinceDate);
  return fetchYnabJson(`/plans/${planId}/transactions?since_date=${encodedDate}`);
}

function buildForecastPayload({ plan, categoriesData, transactionsData, monthsToAnalyze }) {
  const forecastWindows = buildMonthWindows(monthsToAnalyze);
  const trendWindows = buildMonthWindowsBetween(plan.first_month || forecastWindows[0]?.key);
  const trendSnapshots = trendWindows.map((window) => ({
    month: window.key,
    income: 0,
    incomeBySource: {},
    categorySpending: {},
    flags: {
      hadStartingBalance: false,
    },
  }));
  const trendSnapshotLookup = new Map(trendSnapshots.map((snapshot) => [snapshot.month, snapshot]));

  const flattenedCategories = (categoriesData.category_groups || [])
    .filter((group) => !group.hidden)
    .flatMap((group) =>
      (group.categories || [])
        .filter((category) => !category.hidden && !category.deleted)
        .map((category) => {
          const hasTarget = Boolean(category.goal_target);
          const hasGoal = Boolean(category.goal_target && (category.goal_target_date || category.goal_target_month));
          const hasRecurringTarget = Boolean(hasTarget && !hasGoal);
          const normalized = {
            id: category.id,
            name: category.name,
            groupName: group.name,
            currentAvailable: moneyFromMilliunits(category.balance || 0),
            goalTarget: category.goal_target ? moneyFromMilliunits(category.goal_target) : null,
            dueDate: category.goal_target_date || category.goal_target_month || null,
            goalNeedsWholeAmount: category.goal_needs_whole_amount,
            goalType: category.goal_type || null,
            hasGoal,
            hasRecurringTarget,
            hasTarget,
          };

          return {
            ...normalized,
            excludedFromSpending: defaultExcludedCategoryMatcher(normalized),
          };
        }),
    );

  const categoryLookup = new Map(flattenedCategories.map((category) => [category.id, category]));
  const incomeSourceCandidates = new Map();

  for (const transaction of transactionsData.transactions || []) {
    if (transaction.deleted) continue;

    const entries = normalizeSubtransactions(transaction);

    for (const entry of entries) {
      const monthKey = entry.date?.slice(0, 7);
      const snapshot = trendSnapshotLookup.get(monthKey);
      if (!snapshot) continue;

      if (entry.amount > 0 && !entry.transfer_account_id) {
        const classification = classifyPositiveInflow(entry);
        const payeeName = entry.payee_name || "Unknown income source";
        const amount = moneyFromMilliunits(entry.amount);

        if (classification === "starting_balance") {
          snapshot.flags.hadStartingBalance = true;
        }

        if (classification !== "starting_balance" && classification !== "reconciliation" && shouldCountAsIncome(entry)) {
          const existing = incomeSourceCandidates.get(payeeName) || {
            name: payeeName,
            months: new Set(),
            totalAmount: 0,
            transactionCount: 0,
            classification,
          };
          existing.months.add(monthKey);
          existing.totalAmount += amount;
          existing.transactionCount += 1;
          existing.classification = existing.classification === "income_candidate" ? classification : existing.classification;
          incomeSourceCandidates.set(payeeName, existing);
        }
      }
    }
  }

  const incomeSourceOptions = [...incomeSourceCandidates.values()]
    .map((source) => {
      const suggestedSelected =
        source.classification === "income_candidate" &&
        (source.months.size >= 2 || isLikelyRecurringIncomePayee(source.name));

      return {
        name: source.name,
        monthsSeen: source.months.size,
        totalAmount: roundCurrency(source.totalAmount),
        averageMonthlyAmount: roundCurrency(source.totalAmount / Math.max(1, source.months.size)),
        suggestedSelected,
        classification: source.classification,
      };
    })
    .sort((left, right) => right.averageMonthlyAmount - left.averageMonthlyAmount);

  const selectedIncomeSources = new Set(
    incomeSourceOptions.filter((source) => source.suggestedSelected).map((source) => source.name),
  );

  for (const transaction of transactionsData.transactions || []) {
    if (transaction.deleted) continue;

    const entries = normalizeSubtransactions(transaction);

    for (const entry of entries) {
      const monthKey = entry.date?.slice(0, 7);
      const snapshot = trendSnapshotLookup.get(monthKey);
      if (!snapshot) continue;

      if (shouldCountAsIncome(entry) && !entry.transfer_account_id && entry.amount > 0) {
        const classification = classifyPositiveInflow(entry);
        const payeeName = entry.payee_name || "Unknown income source";
        const amount = moneyFromMilliunits(entry.amount);

        if (classification !== "starting_balance" && classification !== "reconciliation") {
          snapshot.incomeBySource[payeeName] = (snapshot.incomeBySource[payeeName] || 0) + amount;
          if (selectedIncomeSources.has(payeeName)) {
            snapshot.income += amount;
          }
        }
      }

      if (entry.amount < 0 && entry.category_id && categoryLookup.has(entry.category_id)) {
        const category = categoryLookup.get(entry.category_id);
        if (category.excludedFromSpending) continue;
        snapshot.categorySpending[entry.category_id] =
          (snapshot.categorySpending[entry.category_id] || 0) + Math.abs(moneyFromMilliunits(entry.amount));
      }
    }
  }

  for (const snapshot of trendSnapshots) {
    snapshot.excludeFromTrend = snapshot.flags.hadStartingBalance && snapshot.income < 500;
  }

  const forecastSnapshotLookup = new Map(trendSnapshots.map((snapshot) => [snapshot.month, snapshot]));
  const snapshots = forecastWindows
    .map((window) => forecastSnapshotLookup.get(window.key))
    .filter(Boolean);

  const categoryOptions = flattenedCategories
    .map((category) => {
      const monthlySpend = snapshots.map((snapshot) => snapshot.categorySpending[category.id] || 0);
      const averageMonthlySpend = monthlySpend.length
        ? monthlySpend.reduce((sum, amount) => sum + amount, 0) / monthlySpend.length
        : 0;

      return {
        id: category.id,
        name: category.name,
        groupName: category.groupName,
        averageMonthlySpend: roundCurrency(averageMonthlySpend),
        currentAvailable: category.currentAvailable,
        hasGoal: category.hasGoal,
        hasRecurringTarget: category.hasRecurringTarget,
        hasTarget: category.hasTarget,
        targetAmountForPlanning: category.goalTarget,
        suggestedBucket: suggestCategoryBucket(category),
      };
    })
    .sort((left, right) => {
      const leftTargetWeight = left.hasTarget ? 1 : 0;
      const rightTargetWeight = right.hasTarget ? 1 : 0;
      if (rightTargetWeight !== leftTargetWeight) {
        return rightTargetWeight - leftTargetWeight;
      }
      return right.averageMonthlySpend - left.averageMonthlySpend;
    });

  const goals = flattenedCategories
    .filter((category) => category.hasGoal)
    .map((category) => ({
      id: category.id,
      name: category.name,
      targetAmount: category.goalTarget,
      currentAvailable: category.currentAvailable,
      dueDate: category.dueDate,
    }));

  const recurringTargets = flattenedCategories
    .filter((category) => category.hasRecurringTarget)
    .map((category) => ({
      id: category.id,
      name: category.name,
      groupName: category.groupName,
      targetAmount: category.goalTarget,
      currentAvailable: category.currentAvailable,
      goalType: category.goalType,
    }))
    .sort((left, right) => (right.targetAmount || 0) - (left.targetAmount || 0));

  const suggestedProtectedCategoryIds = categoryOptions
    .filter((category) => category.suggestedBucket === "essential")
    .map((category) => category.id);

  return {
    budgetName: plan.name,
    currency: plan.currency_format?.iso_code || "USD",
    monthsAnalyzed: monthsToAnalyze,
    monthlySnapshots: snapshots,
    trendSnapshots,
    goals,
    recurringTargets,
    categoryOptions,
    incomeSourceOptions,
    suggestedIncomeSources: [...selectedIncomeSources],
    suggestedProtectedCategoryIds,
    bigPurchaseScenario: {
      name: "Big Purchase",
      amount: Number(process.env.DEFAULT_SCENARIO_AMOUNT || 500),
    },
    source: {
      planId: plan.id,
      firstMonth: plan.first_month,
      lastMonth: plan.last_month,
      asOfDate: currentDate.toISOString().slice(0, 10),
    },
    assumptions: [
      "Income is estimated conservatively from recurring inflow sources, not one-off refunds, reimbursements, or starting balances.",
      "Spending trends are based on the last complete months, not the current partial month.",
      "Internal and reimbursement-style categories are excluded from spending trends by default.",
      "Only categories with a target date are shown as dated goals; recurring monthly NEED targets are treated as ongoing plan categories instead.",
      "Protected categories are suggested automatically and should be reviewed before relying on the buffer number.",
    ],
  };
}

app.get("/api/forecast", async (_request, response) => {
  const planId = process.env.YNAB_PLAN_ID || "default";
  const monthsToAnalyze = Number(process.env.YNAB_MONTHS_TO_ANALYZE || 3);

  try {
    const [planData, categoriesData] = await Promise.all([loadPlanSummary(planId), loadCategories(planId)]);
    const forecastWindows = buildMonthWindows(monthsToAnalyze);
    const sinceDate =
      parseMonthKey(planData.plan.first_month || forecastWindows[0]?.key)?.toISOString().slice(0, 10) ||
      forecastWindows[0]?.start.toISOString().slice(0, 10);
    const transactionsData = await loadTransactions(planId, sinceDate);

    const payload = buildForecastPayload({
      plan: planData.plan,
      categoriesData,
      transactionsData,
      monthsToAnalyze,
    });

    response.json(payload);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load YNAB data.",
    });
  }
});

app.get("/api/status", (_request, response) => {
  response.json({
    configured: Boolean(process.env.YNAB_ACCESS_TOKEN),
    planId: process.env.YNAB_PLAN_ID || "default",
  });
});

const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));
app.get("/{*splat}", (_request, response) => {
  response.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`YNAB dashboard server listening on http://localhost:${port}`);
});
