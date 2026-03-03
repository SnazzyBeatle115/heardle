export const ROUND_DURATIONS_MS = [1000, 2000, 3000, 4000, 5000, 6000] as const;

export type GameMode = "daily" | "random";

export function normalizeGuess(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/\([^)]*\)/g, "")
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ");
}

export function getUtcDateKey(date = new Date()): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function getRoundDuration(round: number): number {
    return ROUND_DURATIONS_MS[Math.max(0, Math.min(round - 1, ROUND_DURATIONS_MS.length - 1))];
}
