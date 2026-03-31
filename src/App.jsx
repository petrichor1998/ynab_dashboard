import { useEffect, useMemo, useState } from "react";
import { sampleBudget } from "./data/sampleBudget";
import { buildForecastModel } from "./lib/forecast";

const categoryStorageKey = "ynab-category-buckets";
const sandboxStorageKey = "ynab-sandbox-plan";
const bucketOptions = ["essential", "flexible", "wealth", "ignore"];

function makeCurrencyFormatter(currencyCode) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
    maximumFractionDigits: 0,
  });
}

function formatMonthLabel(monthKey) {
  if (!monthKey) return "";
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatDateLabel(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function formatIncomeArrivalLabel(timing, day) {
  if (timing === "first") return "First day of each month";
  if (timing === "last") return "Last day of each month";
  return `Day ${day} of each month`;
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizePositiveInteger(value, fallback = 1) {
  const digitsOnly = String(value ?? "").replace(/\D/g, "");
  if (!digitsOnly) return fallback;
  return Math.max(1, Number.parseInt(digitsOnly, 10));
}

function sanitizeDayOfMonth(value) {
  if (value === "") return null;
  const digitsOnly = String(value ?? "").replace(/\D/g, "");
  if (!digitsOnly) return null;
  return Math.max(1, Math.min(31, Number.parseInt(digitsOnly, 10)));
}

function sanitizeNonNegativeNumber(value, fallback = 0) {
  if (value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function parsePlanningTargetOverride(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

function normalizeSandboxPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      forecastedIncome: null,
      incomeArrivalTiming: "custom",
      incomeArrivalDay: 28,
      flexibleSpendingTarget: null,
      wealthSpendingTarget: null,
      essentialSpendingMode: "target",
      flexibleSpendingMode: "target",
      categoryTargetOverrides: {},
      goalSettings: {},
    };
  }

  return {
    forecastedIncome: typeof value.forecastedIncome === "number" ? value.forecastedIncome : null,
    incomeArrivalTiming: value.incomeArrivalTiming === "first" || value.incomeArrivalTiming === "last" ? value.incomeArrivalTiming : "custom",
    incomeArrivalDay: Math.max(1, Math.min(31, Number(value.incomeArrivalDay) || 28)),
    flexibleSpendingTarget:
      typeof value.flexibleSpendingTarget === "number" ? value.flexibleSpendingTarget : null,
    wealthSpendingTarget:
      typeof value.wealthSpendingTarget === "number" ? value.wealthSpendingTarget : null,
    essentialSpendingMode: value.essentialSpendingMode === "average" ? "average" : "target",
    flexibleSpendingMode: value.flexibleSpendingMode === "target" ? "target" : "average",
    categoryTargetOverrides:
      value.categoryTargetOverrides && typeof value.categoryTargetOverrides === "object"
        ? Object.fromEntries(
            Object.entries(value.categoryTargetOverrides).map(([categoryId, overrideValue]) => {
              if (overrideValue === "") return [categoryId, ""];
              const parsed = parsePlanningTargetOverride(overrideValue);
              return [categoryId, parsed ?? ""];
            }),
          )
        : {},
    goalSettings: value.goalSettings && typeof value.goalSettings === "object" ? value.goalSettings : {},
  };
}

function StatusPill({ status }) {
  return <span className={`status-pill status-${String(status).toLowerCase().replaceAll(" ", "-")}`}>{status}</span>;
}

function MetricCard({ label, value, detail }) {
  return (
    <article className="metric-card">
      <p className="eyebrow">{label}</p>
      <h3>{value}</h3>
      <p>{detail}</p>
    </article>
  );
}

function GoalCard({ goal, formatCurrency, settings, onGoalSettingChange }) {
  const priorityValue = sanitizePositiveInteger(settings.priority ?? goal.priority);
  const monthsValue = sanitizePositiveInteger(settings.monthsToAchieve ?? goal.monthsRemaining);
  const plannedValue = settings.plannedMonthlyContribution ?? goal.plannedMonthlyContribution;

  return (
    <article className="goal-card">
      <div className="goal-header">
        <div>
          <p className="eyebrow">Dated Goal</p>
          <h3>{goal.name}</h3>
        </div>
        <StatusPill status={goal.status} />
      </div>

      <div className="goal-grid">
        <div>
          <span>Priority</span>
          <strong>{goal.priority}</strong>
        </div>
        <div>
          <span>Exact due date</span>
          <strong>{formatDateLabel(goal.dueDate)}</strong>
        </div>
        <div>
          <span>Current available</span>
          <strong>{formatCurrency(goal.currentAvailable)}</strong>
        </div>
        <div>
          <span>Amount remaining</span>
          <strong>{formatCurrency(goal.amountRemaining)}</strong>
        </div>
        <div>
          <span>Months remaining</span>
          <strong>{goal.actualMonthsRemaining}</strong>
        </div>
        <div>
          <span>Income arrivals before due date</span>
          <strong>{goal.incomeArrivalsRemaining}</strong>
        </div>
        <div>
          <span>Planned arrivals to achieve</span>
          <strong>{goal.monthsRemaining}</strong>
        </div>
        <div>
          <span>Required monthly pace</span>
          <strong>{formatCurrency(goal.requiredMonthlyContribution)}</strong>
        </div>
        <div>
          <span>Planned monthly contribution</span>
          <strong>{formatCurrency(goal.plannedMonthlyContribution)}</strong>
        </div>
        <div>
          <span>Funded this month in full plan</span>
          <strong>{formatCurrency(goal.fundedThisMonth)}</strong>
        </div>
        <div>
          <span>Monthly gap</span>
          <strong>{formatCurrency(goal.gapThisMonth)}</strong>
        </div>
      </div>

      <div className="goal-planner goal-planner-grid">
        <label>
          <span>Priority rank</span>
          <input
            type="text"
            inputMode="numeric"
            value={String(priorityValue)}
            onChange={(event) => onGoalSettingChange(goal.id, "priority", event.target.value)}
          />
        </label>
        <label>
          <span>Income arrivals to achieve</span>
          <input
            type="text"
            inputMode="numeric"
            value={String(monthsValue)}
            onChange={(event) => onGoalSettingChange(goal.id, "monthsToAchieve", event.target.value)}
          />
        </label>
        <label>
          <span>Planned monthly contribution</span>
          <input
            type="number"
            min="0"
            step="25"
            value={plannedValue}
            onChange={(event) => onGoalSettingChange(goal.id, "plannedMonthlyContribution", event.target.value)}
          />
        </label>
        <p className="goal-note">
          Lower priority number means the goal gets funded earlier when monthly room is tight. At this pace, the goal is projected to reach <strong>{formatCurrency(goal.projectedByDeadline)}</strong> by the deadline.
        </p>
      </div>
    </article>
  );
}

function ConnectError({ error }) {
  return (
    <section className="section-block connect-card">
      <p className="eyebrow">Connection Needed</p>
      <h2>Real YNAB data is not connected yet.</h2>
      <p>{error}</p>
      <ol>
        <li>Create a personal access token in YNAB.</li>
        <li>Copy `.env.example` to `.env` and set `YNAB_ACCESS_TOKEN`.</li>
        <li>Run `npm start` and open `http://localhost:8787`.</li>
      </ol>
    </section>
  );
}

function CategoryBucketList({ categories, categoryBuckets, categoryTargetOverrides, onChange, onTargetChange, formatCurrency }) {
  return (
    <div className="control-list">
      {categories.map((category) => {
        const override = categoryTargetOverrides[category.id];
        const displayedTarget = override ?? category.targetAmountForPlanning;

        return (
          <div className="control-option bucket-option" key={category.id}>
            <div>
              <strong>{category.name}</strong>
              <span>
                {category.groupName} - Avg spend {formatCurrency(category.averageMonthlySpend)}
                {displayedTarget ? ` - Target ${formatCurrency(displayedTarget)}` : ""}
                {category.hasRecurringTarget ? " - recurring target" : ""}
              </span>
            </div>
            <input
              className="scenario-input"
              type="number"
              min="0"
              step="25"
              value={override ?? category.targetAmountForPlanning ?? ""}
              onChange={(event) => onTargetChange(category.id, event.target.value)}
              placeholder={String(category.targetAmountForPlanning ?? "")}
            />
            <select value={categoryBuckets[category.id] || category.suggestedBucket} onChange={(event) => onChange(category.id, event.target.value)}>
              {bucketOptions.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {bucket}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function getCategoryPlanningTargetDisplay(category, categoryTargetOverrides) {
  const override = categoryTargetOverrides[category.id];
  if (override === "") return null;
  return parsePlanningTargetOverride(override) ?? category.targetAmountForPlanning ?? null;
}

function ViewToggle({ activeView, onChange }) {
  return (
    <section className="view-switcher" aria-label="Page view">
      <button className={activeView === "dashboard" ? "view-button is-active" : "view-button"} type="button" onClick={() => onChange("dashboard")}>
        Goal dashboard
      </button>
      <button className={activeView === "trends" ? "view-button is-active" : "view-button"} type="button" onClick={() => onChange("trends")}>
        Spending trends
      </button>
    </section>
  );
}

function TrendRangeToggle({ activeRange, onChange }) {
  const ranges = [
    { id: "3m", label: "3m" },
    { id: "6m", label: "6m" },
    { id: "12m", label: "12m" },
    { id: "24m", label: "24m" },
    { id: "all", label: "All time" },
  ];

  return (
    <div className="trend-range-toggle" aria-label="Trend range">
      {ranges.map((range) => (
        <button
          key={range.id}
          className={activeRange === range.id ? "trend-range-button is-active" : "trend-range-button"}
          type="button"
          onClick={() => onChange(range.id)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

function TrendSparkline({ months, target, formatCurrency }) {
  if (!months.length) {
    return <div className="sparkline-empty">No monthly history yet.</div>;
  }

  const width = 220;
  const height = 56;
  const maxValue = Math.max(target || 0, ...months.map((month) => month.spend), 1);
  const points = months.map((month, index) => {
    const x = months.length === 1 ? width / 2 : (index / (months.length - 1)) * width;
    const y = height - (month.spend / maxValue) * (height - 10) - 5;
    return `${x},${Math.max(5, Math.min(height - 5, y))}`;
  });
  const targetY = target != null ? height - (target / maxValue) * (height - 10) - 5 : null;
  const latest = months[months.length - 1];
  const latestPoint = points[points.length - 1]?.split(",") || [width, height / 2];

  return (
    <div className="sparkline-shell">
      <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="Category spending sparkline">
        {targetY != null ? <line className="sparkline-target" x1="0" y1={targetY} x2={width} y2={targetY} /> : null}
        <polyline className="sparkline-line" points={points.join(" ")} />
        <circle className="sparkline-dot" cx={latestPoint[0]} cy={latestPoint[1]} r="3.5" />
      </svg>
      <div className="sparkline-caption">
        <span>{months[0]?.label} to {latest?.label}</span>
        <strong>{formatCurrency(latest?.spend || 0)}</strong>
      </div>
    </div>
  );
}

function CategoryTrendList({ rows, formatCurrency }) {
  return (
    <div className="trend-table">
      <div className="trend-table-header">
        <span>Category</span>
        <span>Recent trend</span>
        <span>Planning target</span>
        <span>Average</span>
        <span>Latest</span>
        <span>Gap</span>
      </div>
      {rows.map((row) => (
        <article className="trend-row" key={row.id}>
          <div className="trend-cell trend-category-cell">
            <p className="eyebrow">{row.groupName}</p>
            <strong>{row.name}</strong>
            <span>{row.bucketLabel}</span>
          </div>
          <div className="trend-cell trend-line-cell">
            <TrendSparkline months={row.months} target={row.planningTarget} formatCurrency={formatCurrency} />
          </div>
          <div className="trend-cell"><strong>{row.planningTarget != null ? formatCurrency(row.planningTarget) : "No target"}</strong></div>
          <div className="trend-cell"><strong>{formatCurrency(row.averageSpend)}</strong></div>
          <div className="trend-cell"><strong>{formatCurrency(row.latestSpend)}</strong></div>
          <div className="trend-cell"><strong>{row.planningTarget != null ? formatCurrency(row.latestSpend - row.planningTarget) : "-"}</strong></div>
        </article>
      ))}
    </div>
  );
}

function ScenarioRiskList({ risks, formatCurrency }) {
  if (!risks.length) {
    return <p className="scenario-risk-empty">No goals look likely to slip at this purchase amount.</p>;
  }

  return (
    <div className="risk-list">
      {risks.map((risk) => (
        <article className="risk-card" key={risk.id}>
          <div className="risk-topline">
            <strong>{risk.name}</strong>
            <StatusPill status={risk.status} />
          </div>
          <p>
            Priority {risk.priority} · planned {formatCurrency(risk.plannedMonthlyContribution)} this month but would be short by <strong>{formatCurrency(risk.gapThisMonth)}</strong>.
          </p>
        </article>
      ))}
    </div>
  );
}

function CutSuggestionList({ model, formatCurrency }) {
  const { cutSuggestions } = model;

  if (!cutSuggestions || cutSuggestions.monthlyShortfall <= 0) {
    return (
      <article className="scenario-card">
        <p className="eyebrow">Cut Suggestions</p>
        <h2>No spending cuts needed right now</h2>
        <p>{cutSuggestions?.summary || "Your current full plan already covers the goal targets."}</p>
      </article>
    );
  }

  return (
    <article className="scenario-card">
      <p className="eyebrow">Cut Suggestions</p>
      <h2>How to close the monthly shortfall</h2>
      <p>
        The model sees a monthly shortfall of <strong>{formatCurrency(cutSuggestions.monthlyShortfall)}</strong>. {cutSuggestions.summary}
      </p>
      <p>
        Start with flexible cuts of <strong>{formatCurrency(cutSuggestions.flexible.suggestedCut)}</strong>
        {cutSuggestions.wealth.suggestedCut > 0 ? `, then wealth cuts of ${formatCurrency(cutSuggestions.wealth.suggestedCut)}` : ""}.
      </p>
      {cutSuggestions.flexible.categoryCuts.length ? (
        <div className="risk-list">
          {cutSuggestions.flexible.categoryCuts.slice(0, 4).map((category) => (
            <article className="risk-card" key={`flex-${category.id}`}>
              <div className="risk-topline">
                <strong>{category.name}</strong>
                <StatusPill status="Flexible cut" />
              </div>
              <p>
                Cut about <strong>{formatCurrency(category.suggestedCut)}</strong> from a current level of {formatCurrency(category.currentLevel)}.
              </p>
            </article>
          ))}
          {cutSuggestions.wealth.categoryCuts.slice(0, 3).map((category) => (
            <article className="risk-card" key={`wealth-${category.id}`}>
              <div className="risk-topline">
                <strong>{category.name}</strong>
                <StatusPill status="Wealth cut" />
              </div>
              <p>
                If needed, cut about <strong>{formatCurrency(category.suggestedCut)}</strong> from a current level of {formatCurrency(category.currentLevel)}.
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function buildFallbackBudget() {
  return {
    ...sampleBudget,
    wealthCategoryIds: [],
    recurringTargets: [],
  };
}

function App() {
  const [remoteBudget, setRemoteBudget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [categoryBuckets, setCategoryBuckets] = useState({});
  const [showNonTargetCategories, setShowNonTargetCategories] = useState(false);
  const [activeView, setActiveView] = useState("dashboard");
  const [trendRange, setTrendRange] = useState("12m");
  const [scenarioAmount, setScenarioAmount] = useState(sampleBudget.bigPurchaseScenario.amount);
  const [sandboxPlan, setSandboxPlan] = useState({
    forecastedIncome: null,
    incomeArrivalTiming: "custom",
    incomeArrivalDay: 28,
    flexibleSpendingTarget: null,
    wealthSpendingTarget: null,
    essentialSpendingMode: "target",
    flexibleSpendingMode: "target",
    categoryTargetOverrides: {},
    goalSettings: {},
  });

  useEffect(() => {
    let active = true;

    async function loadForecastInput() {
      try {
        const response = await fetch("/api/forecast");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load YNAB forecast data.");
        }
        if (!active) return;

        setRemoteBudget(payload);
        setScenarioAmount(payload.bigPurchaseScenario.amount);

        const storedBuckets = safeJsonParse(window.localStorage.getItem(categoryStorageKey), null);
        const initialBuckets = storedBuckets && typeof storedBuckets === "object" && !Array.isArray(storedBuckets)
          ? storedBuckets
          : Object.fromEntries(payload.categoryOptions.map((category) => [category.id, category.suggestedBucket]));
        setCategoryBuckets(initialBuckets);

        const storedSandbox = safeJsonParse(window.localStorage.getItem(sandboxStorageKey), null);
        setSandboxPlan(normalizeSandboxPlan(storedSandbox));
      } catch (caughtError) {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load YNAB forecast data.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadForecastInput();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Object.keys(categoryBuckets).length > 0) {
      window.localStorage.setItem(categoryStorageKey, JSON.stringify(categoryBuckets));
    }
  }, [categoryBuckets]);

  useEffect(() => {
    window.localStorage.setItem(sandboxStorageKey, JSON.stringify(sandboxPlan));
  }, [sandboxPlan]);

  const normalizedSandbox = useMemo(() => normalizeSandboxPlan(sandboxPlan), [sandboxPlan]);

  const budgetInput = useMemo(() => {
    if (!remoteBudget) {
      return buildFallbackBudget();
    }

    const protectedCategoryIds = remoteBudget.categoryOptions.filter((category) => categoryBuckets[category.id] === "essential").map((category) => category.id);
    const discretionaryCategoryIds = remoteBudget.categoryOptions.filter((category) => categoryBuckets[category.id] === "flexible").map((category) => category.id);
    const wealthCategoryIds = remoteBudget.categoryOptions.filter((category) => categoryBuckets[category.id] === "wealth").map((category) => category.id);

    return {
      ...remoteBudget,
      categoryOptions: remoteBudget.categoryOptions.map((category) => ({
        ...category,
        planningTargetOverride: parsePlanningTargetOverride(normalizedSandbox.categoryTargetOverrides[category.id]),
      })),
      protectedCategoryIds,
      discretionaryCategoryIds,
      wealthCategoryIds,
      bigPurchaseScenario: {
        name: "Big Purchase",
        amount: Number.isFinite(Number(scenarioAmount)) ? Number(scenarioAmount) : 0,
      },
      scenarioPlan: normalizedSandbox,
    };
  }, [categoryBuckets, remoteBudget, scenarioAmount, sandboxPlan]);

  const model = useMemo(() => buildForecastModel(budgetInput), [budgetInput]);
  const forecastMonths = useMemo(() => {
    const snapshots = (budgetInput.monthlySnapshots || []).filter((month) => !month.excludeFromTrend);
    return snapshots.length ? snapshots : budgetInput.monthlySnapshots || [];
  }, [budgetInput]);
  const forecastMonthLabel = useMemo(() => {
    if (!forecastMonths.length) return "";
    const labels = forecastMonths.map((month) => formatMonthLabel(month.month));
    return labels.length === 1 ? labels[0] : `${labels[0]} to ${labels[labels.length - 1]}`;
  }, [forecastMonths]);
  const trendHistorySnapshots = useMemo(() => {
    const snapshots = remoteBudget?.trendSnapshots || budgetInput.monthlySnapshots || [];
    const filtered = snapshots.filter((month) => !month.excludeFromTrend);
    return filtered.length ? filtered : snapshots;
  }, [remoteBudget, budgetInput]);
  const filteredTrendSnapshots = useMemo(() => {
    if (trendRange === "all") return trendHistorySnapshots;
    const count = Number.parseInt(trendRange, 10);
    if (!Number.isFinite(count) || count <= 0) return trendHistorySnapshots;
    return trendHistorySnapshots.slice(-count);
  }, [trendHistorySnapshots, trendRange]);
  const trendMonthLabel = useMemo(() => {
    if (!filteredTrendSnapshots.length) return "";
    const labels = filteredTrendSnapshots.map((month) => formatMonthLabel(month.month));
    return labels.length === 1 ? labels[0] : `${labels[0]} to ${labels[labels.length - 1]}`;
  }, [filteredTrendSnapshots]);
  const presetCategories = useMemo(
    () => (remoteBudget?.categoryOptions || []).filter((category) => !category.hasGoal),
    [remoteBudget],
  );
  const targetPresetCategories = useMemo(
    () =>
      presetCategories.filter(
        (category) => category.hasTarget || category.hasRecurringTarget || Number(category.targetAmountForPlanning) > 0,
      ),
    [presetCategories],
  );
  const nonTargetPresetCategories = useMemo(
    () =>
      presetCategories.filter(
        (category) => !(category.hasTarget || category.hasRecurringTarget || Number(category.targetAmountForPlanning) > 0),
      ),
    [presetCategories],
  );
  const categoryTrendRows = useMemo(() => {
    return presetCategories
      .map((category) => {
        const planningTarget = getCategoryPlanningTargetDisplay(category, normalizedSandbox.categoryTargetOverrides);
        const months = filteredTrendSnapshots.map((snapshot) => ({
          month: snapshot.month,
          label: formatMonthLabel(snapshot.month),
          spend: snapshot.categorySpending?.[category.id] || 0,
        }));
        const latestSpend = months[months.length - 1]?.spend || 0;
        const averageSpend = months.length
          ? months.reduce((sum, month) => sum + month.spend, 0) / months.length
          : category.averageMonthlySpend;

        return {
          id: category.id,
          name: category.name,
          groupName: category.groupName,
          bucketLabel: categoryBuckets[category.id] || category.suggestedBucket,
          planningTarget,
          averageSpend,
          latestSpend,
          months,
        };
      })
      .sort((left, right) => {
        const leftTargetWeight = left.planningTarget != null ? 1 : 0;
        const rightTargetWeight = right.planningTarget != null ? 1 : 0;
        if (rightTargetWeight !== leftTargetWeight) return rightTargetWeight - leftTargetWeight;
        return (right.planningTarget || 0) - (left.planningTarget || 0);
      });
  }, [presetCategories, normalizedSandbox.categoryTargetOverrides, filteredTrendSnapshots, categoryBuckets]);
  const formatCurrency = useMemo(() => {
    const formatter = makeCurrencyFormatter(model.currency);
    return (value) => formatter.format(value);
  }, [model.currency]);

  function setCategoryBucket(categoryId, bucket) {
    setCategoryBuckets((current) => ({ ...current, [categoryId]: bucket }));
  }

  function setGoalSetting(goalId, field, value) {
    setSandboxPlan((current) => {
      const normalizedCurrent = normalizeSandboxPlan(current);
      const existingSettings = normalizedCurrent.goalSettings[goalId] || {};
      let nextValue;

      if (field === "priority" || field === "monthsToAchieve") {
        nextValue = sanitizePositiveInteger(value);
      } else {
        nextValue = sanitizeNonNegativeNumber(value, 0);
      }

      return {
        ...normalizedCurrent,
        goalSettings: {
          ...normalizedCurrent.goalSettings,
          [goalId]: {
            ...existingSettings,
            [field]: nextValue,
          },
        },
      };
    });
  }

  function setSandboxValue(key, value) {
    setSandboxPlan((current) => ({
      ...normalizeSandboxPlan(current),
      [key]: key === "incomeArrivalDay"
        ? sanitizeDayOfMonth(value)
        : sanitizeNonNegativeNumber(value, 0),
    }));
  }

  function setSandboxCategoryTarget(categoryId, value) {
    setSandboxPlan((current) => {
      const normalizedCurrent = normalizeSandboxPlan(current);
      return {
        ...normalizedCurrent,
        categoryTargetOverrides: {
          ...normalizedCurrent.categoryTargetOverrides,
          [categoryId]: value === "" ? "" : value,
        },
      };
    });
  }

  function setSandboxMode(key, value) {
    setSandboxPlan((current) => {
      const normalizedCurrent = normalizeSandboxPlan(current);
      const nextState = {
        ...normalizedCurrent,
        [key]: value,
      };

      if (key === "incomeArrivalTiming" && value !== "custom") {
        nextState.incomeArrivalDay = normalizedCurrent.incomeArrivalDay || 28;
      }

      return nextState;
    });
  }

  function resetSandbox(modelToReset) {
    setSandboxPlan({
      forecastedIncome: null,
      incomeArrivalTiming: modelToReset.incomeArrivalTiming,
      incomeArrivalDay: modelToReset.incomeArrivalDay,
      flexibleSpendingTarget: modelToReset.baselineFlexibleSpending,
      wealthSpendingTarget: modelToReset.targetWealthBuildingSpending,
      essentialSpendingMode: "target",
      flexibleSpendingMode: "target",
      categoryTargetOverrides: {},
      goalSettings: Object.fromEntries(
        modelToReset.goals.map((goal) => [
          goal.id,
          {
            priority: goal.priority,
            monthsToAchieve: goal.incomeArrivalsRemaining,
            plannedMonthlyContribution: goal.requiredMonthlyContribution,
          },
        ]),
      ),
    });
  }

  if (loading) {
    return (
      <main className="app-shell">
        <section className="section-block connect-card">
          <p className="eyebrow">Loading</p>
          <h2>Pulling your YNAB data and building the forecast.</h2>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {error ? <ConnectError error={error} /> : null}

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">YNAB Goal Forecast</p>
          <h1>Plan big purchases around your real priorities.</h1>
          <p className="hero-text">
            You can set goal priority, change the income-arrival windows to achieve a goal, choose whether essential and flexible spending should be modeled from targets or recent averages, and override income when history is noisy.
          </p>
        </div>

        <div className="hero-panel">
          <p className="eyebrow">Forecast Summary</p>
          <h2>{model.budgetName}</h2>
          <div className="summary-line">
            <span>Income timing</span>
            <strong>{formatIncomeArrivalLabel(model.incomeArrivalTiming, model.incomeArrivalDay)}</strong>
          </div>
          <div className="summary-line">
            <span>Free cash flow</span>
            <strong>{formatCurrency(model.freeCashFlow)} / month</strong>
          </div>
          <div className="summary-line">
            <span>Goal room in full plan</span>
            <strong>{formatCurrency(model.totalAvailableForGoalsUnderFullPlan)} / month</strong>
          </div>
          <div className="summary-line">
            <span>Remaining monthly buffer</span>
            <strong>{formatCurrency(model.monthlyBufferAfterGoals)} / month</strong>
          </div>
        </div>
      </section>

      <ViewToggle activeView={activeView} onChange={setActiveView} />

      {activeView === "dashboard" ? (
        <section className="sticky-summary" aria-label="Live forecast summary">
          <div className="sticky-summary-item">
            <span>Income timing</span>
            <strong>{formatIncomeArrivalLabel(model.incomeArrivalTiming, model.incomeArrivalDay)}</strong>
          </div>
          <div className="sticky-summary-item">
            <span>Free cash flow</span>
            <strong>{formatCurrency(model.freeCashFlow)} / month</strong>
          </div>
          <div className="sticky-summary-item">
            <span>Goal room</span>
            <strong>{formatCurrency(model.totalAvailableForGoalsUnderFullPlan)} / month</strong>
          </div>
          <div className="sticky-summary-item">
            <span>Buffer</span>
            <strong>{formatCurrency(model.monthlyBufferAfterGoals)} / month</strong>
          </div>
        </section>
      ) : null}

      {activeView === "dashboard" ? (
        <>
      <section className="metrics-section metrics-four">
        <MetricCard
          label="Forecasted Monthly Income"
          value={formatCurrency(model.avgIncome)}
          detail={
            sandboxPlan.forecastedIncome != null
              ? `Manual override. Historical average uses ${model.monthsAnalyzed} complete months ending ${formatMonthLabel(forecastMonths[forecastMonths.length - 1]?.month)}.`
              : `Weighted average across ${model.monthsAnalyzed} complete months: ${forecastMonthLabel}.`
          }
        />
        <MetricCard
          label="Essential Spending Assumption"
          value={formatCurrency(model.avgProtectedSpending)}
          detail={
            model.essentialSpendingMode === "target"
              ? `Category target total ${formatCurrency(model.targetProtectedSpending)}`
              : `Weighted average spend ${formatCurrency(model.baselineProtectedSpending)}`
          }
        />
        <MetricCard label="Flexible Spending Assumption" value={formatCurrency(model.avgDiscretionarySpending)} detail={model.flexibleSpendingMode === "target" ? `Category target total ${formatCurrency(model.targetFlexibleSpending)}` : `Worst recent month ${formatCurrency(model.worstFlexibleSpending)}`} />
        <MetricCard label="Wealth Spending Assumption" value={formatCurrency(model.avgWealthBuildingSpending)} detail={`Category target total ${formatCurrency(model.targetWealthBuildingSpending)}`} />
      </section>

      {remoteBudget ? (
        <section className="section-block two-column">
          <article className="explain-card">
            <p className="eyebrow">Planning Sandbox</p>
            <h2>Try changes without editing YNAB</h2>
            <p className="source-note">Set your own forecasted monthly income, define when income arrives each month, choose how essentials should be modeled, trim flexible spending, or change a goal's priority and pacing to see what stays safe.</p>
            <div className="sandbox-grid">
              <label>
                <span>Forecasted monthly income</span>
                <input
                  className="scenario-input"
                  type="number"
                  min="0"
                  step="50"
                  placeholder={String(model.historicalAvgIncome)}
                  value={sandboxPlan.forecastedIncome ?? ""}
                  onChange={(event) => setSandboxValue("forecastedIncome", event.target.value)}
                />
              </label>
              <label>
                <span>Income timing</span>
                <select className="scenario-input" value={sandboxPlan.incomeArrivalTiming || "custom"} onChange={(event) => setSandboxMode("incomeArrivalTiming", event.target.value)}>
                  <option value="first">First day of each month</option>
                  <option value="last">Last day of each month</option>
                  <option value="custom">Custom day</option>
                </select>
              </label>
              {sandboxPlan.incomeArrivalTiming === "custom" ? (
                <label>
                  <span>Custom income day</span>
                  <input
                    className="scenario-input"
                    type="number"
                    min="1"
                    max="31"
                    step="1"
                    value={sandboxPlan.incomeArrivalDay ?? ""}
                    onChange={(event) => setSandboxValue("incomeArrivalDay", event.target.value)}
                  />
                </label>
              ) : null}
              <label>
                <span>Essential spending target</span>
                <input className="scenario-input" type="number" min="0" step="25" value={model.targetProtectedSpending} readOnly />
              </label>
              <label>
                <span>Flexible spending target</span>
                <input className="scenario-input" type="number" min="0" step="25" value={sandboxPlan.flexibleSpendingTarget ?? model.baselineFlexibleSpending} onChange={(event) => setSandboxValue("flexibleSpendingTarget", event.target.value)} />
              </label>
              <label>
                <span>Wealth-building target</span>
                <input className="scenario-input" type="number" min="0" step="25" value={sandboxPlan.wealthSpendingTarget ?? model.targetWealthBuildingSpending} onChange={(event) => setSandboxValue("wealthSpendingTarget", event.target.value)} />
              </label>
            </div>
            <p className="source-note">
              Averages are currently based on <strong>{model.monthsAnalyzed} complete months</strong>: {trendMonthLabel}.
            </p>
            <p className="source-note">
              Wealth-building target is simply the sum of all categories currently bucketed as <strong>wealth</strong>.
            </p>
            <label>
              <span>Essential spending mode</span>
              <select className="scenario-input" value={sandboxPlan.essentialSpendingMode || "target"} onChange={(event) => setSandboxMode("essentialSpendingMode", event.target.value)}>
                <option value="target">Use category targets when available</option>
                <option value="average">Use weighted average spending</option>
              </select>
            </label>
            <label>
              <span>Flexible spending mode</span>
              <select className="scenario-input" value={sandboxPlan.flexibleSpendingMode || "target"} onChange={(event) => setSandboxMode("flexibleSpendingMode", event.target.value)}>
                <option value="average">Average behavior</option>
                <option value="target">Use category targets when available</option>
              </select>
            </label>
            <button className="ghost-button" type="button" onClick={() => resetSandbox(model)}>
              Reset Sandbox To Current Pace
            </button>
          </article>

          <article className="scenario-card">
            <p className="eyebrow">Purchase Stress Test</p>
            <h2>What happens if you buy something big?</h2>
            <div className="scenario-input-row">
              <label>
                <span>Purchase amount</span>
                <input className="scenario-input" type="number" min="0" step="25" value={scenarioAmount} onChange={(event) => setScenarioAmount(event.target.value)} />
              </label>
            </div>
            <p>After this purchase, the estimated monthly buffer becomes <strong>{formatCurrency(model.scenario.remainingBuffer)}</strong>.</p>
            <StatusPill status={model.scenario.status} />
            <div className="scenario-risk-block">
              <p className="eyebrow">Goals Most Likely To Slip First</p>
              <ScenarioRiskList risks={model.scenario.goalRisks} formatCurrency={formatCurrency} />
            </div>
          </article>
        </section>
      ) : null}

      {remoteBudget ? (
        <section className="section-block two-column">
          <article className="explain-card">
            <p className="eyebrow">Bucket Logic</p>
            <h2>How flexible and wealth categories compete with goals</h2>
            <p>After essentials are covered, the model assumes one shared monthly pool is left. Flexible and wealth categories use part of that same pool before goals are judged safe.</p>
            <p><strong>Essential</strong> means protect first. <strong>Flexible</strong> means lifestyle spending you could cut if goals matter more. <strong>Wealth</strong> means saving or investing habits that still compete with goals, but are shown separately so you can decide whether to pause them.</p>
            <p>The buckets are not just arithmetic. They tell you what kind of adjustment is available when the plan is tight.</p>
          </article>

          <CutSuggestionList model={model} formatCurrency={formatCurrency} />
        </section>
      ) : null}

      {remoteBudget ? (
        <section className="section-block two-column">
          <article className="scenario-card">
            <p className="eyebrow">Goal Selection</p>
            <h2>Why only some categories appear below</h2>
            <p>Dated goals are the categories YNAB returned with both a target amount and a target date. Recurring monthly NEED targets like Rent or Groceries are still targets, but they are treated as ongoing plan categories instead of countdown goals.</p>
            <p>This budget currently has <strong>{remoteBudget.goals.length}</strong> dated goals and <strong>{remoteBudget.recurringTargets?.length ?? 0}</strong> recurring targets.</p>
          </article>
        </section>
      ) : null}

      {remoteBudget ? (
        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Category Presets</p>
              <h2>Assign each category a planning bucket</h2>
            </div>
            <p>`essential` protects spending first, `flexible` competes with goals, `wealth` tracks saving or investing habits, and `ignore` removes noisy categories. Recurring-target categories can still live in any of those buckets.</p>
          </div>
          <p className="source-note">
            Showing <strong>{targetPresetCategories.length}</strong> categories with YNAB targets first. Hidden section contains <strong>{nonTargetPresetCategories.length}</strong> categories without targets. Together they account for all <strong>{presetCategories.length}</strong> non-goal categories in this plan.
          </p>
          <CategoryBucketList categories={targetPresetCategories} categoryBuckets={categoryBuckets} categoryTargetOverrides={normalizedSandbox.categoryTargetOverrides} onChange={setCategoryBucket} onTargetChange={setSandboxCategoryTarget} formatCurrency={formatCurrency} />
          {nonTargetPresetCategories.length ? (
            <div className="goal-planner">
              <button className="ghost-button" type="button" onClick={() => setShowNonTargetCategories((current) => !current)}>
                {showNonTargetCategories
                  ? `Hide categories without YNAB targets (${nonTargetPresetCategories.length})`
                  : `Show categories without YNAB targets (${nonTargetPresetCategories.length})`}
              </button>
              {showNonTargetCategories ? (
                <CategoryBucketList categories={nonTargetPresetCategories} categoryBuckets={categoryBuckets} categoryTargetOverrides={normalizedSandbox.categoryTargetOverrides} onChange={setCategoryBucket} onTargetChange={setSandboxCategoryTarget} formatCurrency={formatCurrency} />
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Dated Goal Forecasts</p>
            <h2>Target pacing by category</h2>
          </div>
          <p>Statuses below always use the full monthly plan. Lower priority number means the goal is funded earlier when money is tight.</p>
        </div>

        <div className="goal-list">
          {model.goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} formatCurrency={formatCurrency} settings={normalizedSandbox.goalSettings[goal.id] || {}} onGoalSettingChange={setGoalSetting} />
          ))}
        </div>
      </section>

      <section className="section-block formula-strip">
        {model.formulas.map((formula) => (
          <p key={formula}>{formula}</p>
        ))}
        {remoteBudget?.assumptions?.map((assumption) => (
          <p key={assumption}>{assumption}</p>
        ))}
      </section>
        </>
      ) : (
        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Category Trends</p>
              <h2>Category spending trends and target allocation</h2>
            </div>
            <p>Use this view to compare each category's planning target with recent monthly spending before you fine-tune the allocation.</p>
          </div>
          <TrendRangeToggle activeRange={trendRange} onChange={setTrendRange} />
          <p className="source-note">Trend window: <strong>{trendMonthLabel}</strong>. Showing <strong>{filteredTrendSnapshots.length}</strong> complete months{trendRange === "all" ? " across all available history" : " in the selected range"}.</p>
          <CategoryTrendList rows={categoryTrendRows} formatCurrency={formatCurrency} />
        </section>
      )}
    </main>
  );
}

export default App;














