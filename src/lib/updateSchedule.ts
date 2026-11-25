import type { TrackedSource } from "./catalog";

export const updateCheckIntervals = ["disabled", "hourly", "daily", "weekly", "monthly"] as const;
export type UpdateCheckInterval = (typeof updateCheckIntervals)[number];

const intervalMs: Record<Exclude<UpdateCheckInterval, "disabled">, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export function normalizeUpdateCheckInterval(value: unknown): UpdateCheckInterval {
  return (updateCheckIntervals as readonly unknown[]).includes(value)
    ? (value as UpdateCheckInterval)
    : "disabled";
}

export function isUpdateCheckDue(
  interval: UpdateCheckInterval,
  lastCheckedAt: number | undefined,
  now: number,
): boolean {
  if (interval === "disabled") return false;
  if (lastCheckedAt === undefined) return true;
  return now - lastCheckedAt >= intervalMs[interval];
}

export function availableUpdateSignature(updates: TrackedSource[]): string {
  return updates
    .map((source) => `${source.id}@${source.version}`)
    .sort()
    .join("|");
}
