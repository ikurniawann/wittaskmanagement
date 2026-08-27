// Drizzle schema root (protected path — changes require a reviewed task).
// Domain tables land epic by epic: org (T-010), events (T-020), tasks (T-030)…
// `app_settings` ships first so the migration pipeline is proven end-to-end and
// later epics (approval thresholds, health rules) have a place for org config.

export * from "./activity";
export * from "./ai";
export * from "./app-settings";
export * from "./approvals";
export * from "./budgets";
export * from "./collab";
export * from "./dataroom";
export * from "./documents";
export * from "./events";
export * from "./external";
export * from "./notifications";
export * from "./org";
export * from "./pages";
export * from "./run-of-show";
export * from "./subtask-comments";
export * from "./summary-shares";
export * from "./tasks";
export * from "./templates";
export * from "./timeline";
