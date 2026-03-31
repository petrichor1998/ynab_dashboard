export const sampleBudget = {
  budgetName: "Personal Budget",
  currency: "USD",
  monthsAnalyzed: 3,
  monthlySnapshots: [
    {
      month: "2025-12",
      income: 5200,
      categorySpending: {
        housing: 1700,
        groceries: 610,
        utilities: 220,
        transportation: 320,
        insurance: 190,
        dining: 250,
        fun: 180,
      },
    },
    {
      month: "2026-01",
      income: 5350,
      categorySpending: {
        housing: 1700,
        groceries: 640,
        utilities: 210,
        transportation: 340,
        insurance: 190,
        dining: 310,
        fun: 240,
      },
    },
    {
      month: "2026-02",
      income: 5100,
      categorySpending: {
        housing: 1700,
        groceries: 595,
        utilities: 235,
        transportation: 305,
        insurance: 190,
        dining: 280,
        fun: 215,
      },
    },
  ],
  protectedCategoryIds: ["housing", "groceries", "utilities", "transportation", "insurance"],
  discretionaryCategoryIds: ["dining", "fun"],
  goals: [
    {
      id: "vacation",
      name: "Vacation Fund",
      targetAmount: 3000,
      currentAvailable: 1450,
      dueDate: "2026-08-01",
    },
    {
      id: "new-laptop",
      name: "New Laptop",
      targetAmount: 2200,
      currentAvailable: 900,
      dueDate: "2026-06-01",
    },
  ],
  bigPurchaseScenario: {
    name: "Weekend Trip Booking",
    amount: 450,
  },
};
