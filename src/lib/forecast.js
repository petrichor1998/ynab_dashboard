function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedAverage(values) {
  if (!values.length) return 0;

  const weights = values.map((_, index) => index + 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  return values.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight;
}

function maxOrZero(values) {
  return values.length ? Math.max(...values) : 0;
}

function sumCategories(categorySpending, ids) {
  return ids.reduce((sum, id) => sum + (categorySpending[id] ?? 0), 0);
}

function getCategoryTargetAmount(category) {
  return category.planningTargetOverride ?? category.targetAmountForPlanning ?? null;
}

function getCategoryPlanningAmount(category) {
  return getCategoryTargetAmount(category) ?? category.averageMonthlySpend ?? 0;
}

function sumCategoryTargetAmounts(categories) {
  return categories.reduce((sum, category) => sum + (getCategoryTargetAmount(category) || 0), 0);
}

function sumCategoryPlanningAmounts(categories) {
  return categories.reduce((sum, category) => sum + getCategoryPlanningAmount(category), 0);
}

function monthsUntilDue(dueDate, currentDate = new Date()) {
  const today = new Date(currentDate);
  const due = new Date(dueDate);
  const months =
    (due.getFullYear() - today.getFullYear()) * 12 + (due.getMonth() - today.getMonth());

  return Math.max(1, months);
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function resolveIncomeArrivalDate(year, monthIndex, incomeArrivalTiming, incomeArrivalDay) {
  if (incomeArrivalTiming === "first") {
    return new Date(year, monthIndex, 1);
  }

  if (incomeArrivalTiming === "last") {
    return new Date(year, monthIndex, lastDayOfMonth(year, monthIndex));
  }

  const safeDay = Math.max(1, Math.min(31, Number(incomeArrivalDay) || 28));
  return new Date(year, monthIndex, Math.min(safeDay, lastDayOfMonth(year, monthIndex)));
}

function nextIncomeArrivalDate(fromDate, incomeArrivalTiming, incomeArrivalDay) {
  const date = new Date(fromDate);
  const candidate = resolveIncomeArrivalDate(
    date.getFullYear(),
    date.getMonth(),
    incomeArrivalTiming,
    incomeArrivalDay,
  );

  if (candidate > date) {
    return candidate;
  }

  return resolveIncomeArrivalDate(
    date.getFullYear(),
    date.getMonth() + 1,
    incomeArrivalTiming,
    incomeArrivalDay,
  );
}

function countIncomeArrivalsUntilDue(currentDate, dueDate, incomeArrivalTiming, incomeArrivalDay) {
  const due = new Date(dueDate);
  let cursor = nextIncomeArrivalDate(currentDate, incomeArrivalTiming, incomeArrivalDay);
  let count = 0;

  while (cursor <= due) {
    count += 1;
    cursor = resolveIncomeArrivalDate(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      incomeArrivalTiming,
      incomeArrivalDay,
    );
  }

  return Math.max(1, count);
}

function sortGoalsForFunding(goals) {
  return [...goals].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    const dueComparison = new Date(left.dueDate) - new Date(right.dueDate);
    if (dueComparison !== 0) {
      return dueComparison;
    }

    return right.requiredMonthlyContribution - left.requiredMonthlyContribution;
  });
}

function allocateFunding(goals, availableAmount) {
  const sortedGoals = sortGoalsForFunding(goals);
  let remaining = availableAmount;

  return sortedGoals.map((goal, index) => {
    const fundedThisMonth = Math.min(goal.plannedMonthlyContribution, Math.max(0, remaining));
    remaining -= fundedThisMonth;
    const gapThisMonth = goal.requiredMonthlyContribution - fundedThisMonth;

    return {
      ...goal,
      allocationIndex: index,
      fundedThisMonth: roundCurrency(fundedThisMonth),
      gapThisMonth: roundCurrency(Math.max(0, gapThisMonth)),
      fullyFundedThisMonth: fundedThisMonth >= goal.requiredMonthlyContribution,
    };
  });
}

function buildBucketCutPlan(categories, shortfall, useTarget = false) {
  if (shortfall <= 0 || !categories.length) {
    return {
      totalReducible: 0,
      suggestedCut: 0,
      categoryCuts: [],
    };
  }

  const rankedCategories = [...categories]
    .map((category) => {
      const baseline = useTarget
        ? (category.targetAmountForPlanning || category.averageMonthlySpend)
        : category.averageMonthlySpend;

      return {
        id: category.id,
        name: category.name,
        groupName: category.groupName,
        currentLevel: roundCurrency(baseline || 0),
      };
    })
    .filter((category) => category.currentLevel > 0)
    .sort((left, right) => right.currentLevel - left.currentLevel);

  let remaining = shortfall;
  const categoryCuts = rankedCategories
    .map((category) => {
      const suggestedCut = Math.min(category.currentLevel, remaining);
      remaining -= suggestedCut;

      return {
        ...category,
        suggestedCut: roundCurrency(suggestedCut),
        suggestedRemaining: roundCurrency(category.currentLevel - suggestedCut),
      };
    })
    .filter((category) => category.suggestedCut > 0);

  const totalReducible = rankedCategories.reduce((sum, category) => sum + category.currentLevel, 0);

  return {
    totalReducible: roundCurrency(totalReducible),
    suggestedCut: roundCurrency(Math.min(shortfall, totalReducible)),
    categoryCuts,
  };
}

export function buildForecastModel(budget, currentDate = new Date()) {
  const trendSnapshots = budget.monthlySnapshots.filter((month) => !month.excludeFromTrend);
  const activeSnapshots = trendSnapshots.length ? trendSnapshots : budget.monthlySnapshots;
  const scenarioPlan = budget.scenarioPlan || {};
  const goalSettings = scenarioPlan.goalSettings || {};
  const incomeArrivalTiming = scenarioPlan.incomeArrivalTiming || "custom";
  const incomeArrivalDay = Math.max(1, Math.min(31, Number(scenarioPlan.incomeArrivalDay) || 28));

  const incomeHistory = activeSnapshots.map((month) => month.income);
  const protectedSpendingHistory = activeSnapshots.map((month) =>
    sumCategories(month.categorySpending, budget.protectedCategoryIds || []),
  );
  const discretionarySpendingHistory = activeSnapshots.map((month) =>
    sumCategories(month.categorySpending, budget.discretionaryCategoryIds || []),
  );
  const wealthBuildingHistory = activeSnapshots.map((month) =>
    sumCategories(month.categorySpending, budget.wealthCategoryIds || []),
  );

  const protectedCategories = (budget.categoryOptions || []).filter((category) =>
    (budget.protectedCategoryIds || []).includes(category.id),
  );
  const flexibleCategories = (budget.categoryOptions || []).filter((category) =>
    (budget.discretionaryCategoryIds || []).includes(category.id),
  );
  const wealthCategories = (budget.categoryOptions || []).filter((category) =>
    (budget.wealthCategoryIds || []).includes(category.id),
  );

  const historicalAvgIncome = weightedAverage(incomeHistory);
  const avgIncome = scenarioPlan.forecastedIncome ?? historicalAvgIncome;
  const baselineProtectedSpending = weightedAverage(protectedSpendingHistory);
  const baselineFlexibleSpending = average(discretionarySpendingHistory);
  const baselineWealthBuildingSpending = average(wealthBuildingHistory);
  const worstFlexibleSpending = maxOrZero(discretionarySpendingHistory);

  const targetProtectedSpending = sumCategoryPlanningAmounts(protectedCategories);
  const targetFlexibleSpending = sumCategoryTargetAmounts(flexibleCategories);
  const targetWealthBuildingSpending = sumCategoryTargetAmounts(wealthCategories);

  const essentialSpendingMode = scenarioPlan.essentialSpendingMode || "target";
  const flexibleSpendingMode = scenarioPlan.flexibleSpendingMode || "target";

  const avgProtectedSpending =
    essentialSpendingMode === "target" ? targetProtectedSpending || baselineProtectedSpending : baselineProtectedSpending;

  const adjustedFlexibleSpending =
    scenarioPlan.flexibleSpendingTarget ??
    (flexibleSpendingMode === "target"
      ? targetFlexibleSpending || baselineFlexibleSpending
      : baselineFlexibleSpending);
  const adjustedWealthBuildingSpending =
    scenarioPlan.wealthSpendingTarget ?? targetWealthBuildingSpending;

  const conservativeFlexibleSpending =
    flexibleSpendingMode === "target"
      ? Math.max(adjustedFlexibleSpending, targetFlexibleSpending || 0)
      : Math.max(adjustedFlexibleSpending, worstFlexibleSpending);
  const conservativeWealthBuildingSpending = Math.max(
    adjustedWealthBuildingSpending,
    targetWealthBuildingSpending,
  );
  const freeCashFlow = avgIncome - avgProtectedSpending;

  const baseGoals = budget.goals.map((goal, index) => {
    const actualMonthsRemaining = monthsUntilDue(goal.dueDate, currentDate);
    const incomeArrivalsRemaining = countIncomeArrivalsUntilDue(
      currentDate,
      goal.dueDate,
      incomeArrivalTiming,
      incomeArrivalDay,
    );
    const amountRemaining = Math.max(0, goal.targetAmount - goal.currentAvailable);
    const settings = goalSettings[goal.id] || {};
    const planningMonths = Math.max(1, Number(settings.monthsToAchieve) || incomeArrivalsRemaining);
    const requiredMonthlyContribution = amountRemaining / planningMonths;
    const plannedMonthlyContribution =
      settings.plannedMonthlyContribution ?? requiredMonthlyContribution;
    const priority = Math.max(1, Number(settings.priority) || index + 1);

    return {
      ...goal,
      priority,
      actualMonthsRemaining,
      incomeArrivalsRemaining,
      monthsRemaining: planningMonths,
      amountRemaining: roundCurrency(amountRemaining),
      requiredMonthlyContribution: roundCurrency(requiredMonthlyContribution),
      plannedMonthlyContribution: roundCurrency(Math.max(0, plannedMonthlyContribution)),
    };
  });

  const totalRequiredForGoals = baseGoals.reduce(
    (sum, goal) => sum + goal.requiredMonthlyContribution,
    0,
  );
  const totalPlannedForGoals = baseGoals.reduce(
    (sum, goal) => sum + goal.plannedMonthlyContribution,
    0,
  );
  const totalAvailableForGoalsUnderFullPlan =
    freeCashFlow - conservativeFlexibleSpending - conservativeWealthBuildingSpending;

  const fullPlanAllocations = allocateFunding(baseGoals, totalAvailableForGoalsUnderFullPlan);
  const allocationMap = new Map(fullPlanAllocations.map((goal) => [goal.id, goal]));

  const goals = sortGoalsForFunding(baseGoals).map((goal) => {
    const allocated = allocationMap.get(goal.id);
    const effectiveMonthlyContribution = Math.min(
      allocated.fundedThisMonth,
      goal.requiredMonthlyContribution,
    );
    const projectedByDeadline = Math.min(
      goal.targetAmount,
      goal.currentAvailable + effectiveMonthlyContribution * goal.monthsRemaining,
    );
    const surplusAtDeadline = projectedByDeadline - goal.targetAmount;

    let status = "On track";
    if (freeCashFlow <= 0) {
      status = "Off track";
    } else if (allocated.fundedThisMonth < goal.requiredMonthlyContribution) {
      status = "At risk";
    }

    return {
      ...goal,
      projectedByDeadline: roundCurrency(projectedByDeadline),
      surplusAtDeadline: roundCurrency(surplusAtDeadline),
      monthlyCapacityForGoal: allocated.fundedThisMonth,
      fundedThisMonth: allocated.fundedThisMonth,
      gapThisMonth: allocated.gapThisMonth,
      status,
    };
  });

  const monthlyBufferAfterGoals =
    freeCashFlow - totalPlannedForGoals - conservativeFlexibleSpending - conservativeWealthBuildingSpending;
  const goalShortfall = Math.max(0, totalRequiredForGoals - totalAvailableForGoalsUnderFullPlan);
  const bufferGap = Math.max(0, -monthlyBufferAfterGoals);
  const overallShortfall = roundCurrency(Math.max(goalShortfall, bufferGap));
  const flexibleCutPlan = buildBucketCutPlan(
    flexibleCategories,
    overallShortfall,
    flexibleSpendingMode === "target",
  );
  const remainingAfterFlexibleCuts = Math.max(0, overallShortfall - flexibleCutPlan.suggestedCut);
  const wealthCutPlan = buildBucketCutPlan(wealthCategories, remainingAfterFlexibleCuts, true);

  const scenarioImpact = monthlyBufferAfterGoals - budget.bigPurchaseScenario.amount;
  const availableForGoalFundingUnderScenario = Math.max(
    0,
    totalAvailableForGoalsUnderFullPlan - budget.bigPurchaseScenario.amount,
  );

  const scenarioGoalAllocations = allocateFunding(baseGoals, availableForGoalFundingUnderScenario);

  return {
    budgetName: budget.budgetName,
    currency: budget.currency || "USD",
    monthsAnalyzed: activeSnapshots.length,
    incomeArrivalTiming,
    incomeArrivalDay,
    avgIncome: roundCurrency(avgIncome),
    historicalAvgIncome: roundCurrency(historicalAvgIncome),
    avgProtectedSpending: roundCurrency(avgProtectedSpending),
    baselineProtectedSpending: roundCurrency(baselineProtectedSpending),
    targetProtectedSpending: roundCurrency(targetProtectedSpending),
    essentialSpendingMode,
    avgDiscretionarySpending: roundCurrency(conservativeFlexibleSpending),
    avgWealthBuildingSpending: roundCurrency(conservativeWealthBuildingSpending),
    baselineFlexibleSpending: roundCurrency(baselineFlexibleSpending),
    baselineWealthBuildingSpending: roundCurrency(baselineWealthBuildingSpending),
    worstFlexibleSpending: roundCurrency(worstFlexibleSpending),
    targetFlexibleSpending: roundCurrency(targetFlexibleSpending),
    targetWealthBuildingSpending: roundCurrency(targetWealthBuildingSpending),
    flexibleSpendingMode,
    freeCashFlow: roundCurrency(freeCashFlow),
    totalRequiredForGoals: roundCurrency(totalRequiredForGoals),
    totalPlannedForGoals: roundCurrency(totalPlannedForGoals),
    totalAvailableForGoalsUnderFullPlan: roundCurrency(totalAvailableForGoalsUnderFullPlan),
    monthlyBufferAfterGoals: roundCurrency(monthlyBufferAfterGoals),
    cutSuggestions: {
      monthlyShortfall: overallShortfall,
      flexible: flexibleCutPlan,
      wealth: wealthCutPlan,
      summary:
        overallShortfall <= 0
          ? "Your current full plan already covers the goal targets."
          : remainingAfterFlexibleCuts > 0
            ? "Flexible cuts alone are not enough, so the model also suggests reducing wealth categories."
            : "The model can close the shortfall using flexible categories alone.",
    },
    scenario: {
      ...budget.bigPurchaseScenario,
      remainingBuffer: roundCurrency(scenarioImpact),
      fundingPoolForGoals: roundCurrency(availableForGoalFundingUnderScenario),
      status: scenarioImpact >= 0 ? "Comfortable" : "Too aggressive",
      goalRisks: scenarioGoalAllocations
        .filter((goal) => goal.gapThisMonth > 0)
        .slice(0, 5)
        .map((goal, index) => ({
          id: goal.id,
          name: goal.name,
          dueDate: goal.dueDate,
          priority: goal.priority,
          requiredMonthlyContribution: goal.requiredMonthlyContribution,
          plannedMonthlyContribution: goal.plannedMonthlyContribution,
          fundedThisMonth: goal.fundedThisMonth,
          gapThisMonth: goal.gapThisMonth,
          status: index === 0 ? "Likely to slip first" : "At risk under scenario",
        })),
    },
    goals,
    formulas: [
      "Weighted average income gives more importance to the most recent months unless you override it with your own forecasted income.",
      "Essential spending can use either category targets when available or recent weighted average spending.",
      "Free cash flow = forecasted income - essential spending assumption.",
      "Required monthly contribution = remaining target amount / income arrivals before the due date, unless you override the planning arrivals.",
      "Priority controls funding order when monthly room is tight. Lower number = higher priority.",
      "Goal status uses the full plan, including conservative flexible and wealth spending assumptions.",
      "Flexible spending can use either average behavior or category target totals when available.",
      "Wealth spending is target-based and uses category target totals by default.",
    ],
  };
}

