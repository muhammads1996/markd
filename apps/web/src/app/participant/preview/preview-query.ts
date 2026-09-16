export const workerViews = ["home", "work", "card", "profile"] as const;
export type WorkerView = (typeof workerViews)[number];

export const workerScenarios = [
  "travel_ready",
  "offer",
  "accepted_waiting",
  "cancelled",
  "no-work",
  "completed",
  "degraded",
] as const;
export type WorkerScenario = (typeof workerScenarios)[number];

export const contractorViews = [
  "home",
  "hire",
  "workers",
  "jobs",
  "empty",
] as const;
export type ContractorView = (typeof contractorViews)[number];

export function isWorkerView(value: string | undefined): value is WorkerView {
  return workerViews.includes(value as WorkerView);
}

export function isWorkerScenario(
  value: string | undefined,
): value is WorkerScenario {
  return workerScenarios.includes(value as WorkerScenario);
}

export function isContractorView(
  value: string | undefined,
): value is ContractorView {
  return contractorViews.includes(value as ContractorView);
}
