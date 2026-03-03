import type { GameMode } from "./game";

const STORAGE_KEY = "heardle:stats:v1";

export type HeardleStats = {
    totalPlayed: number;
    totalWon: number;
    dailyPlayed: number;
    dailyWon: number;
    currentStreak: number;
    bestStreak: number;
    dailyHistory: Record<string, "won" | "lost">;
    dailyAnswers: Record<string, string>;
    dailyEmbedUrls: Record<string, string>;
    randomPlayed: number;
    randomWon: number;
};

const DEFAULT_STATS: HeardleStats = {
    totalPlayed: 0,
    totalWon: 0,
    dailyPlayed: 0,
    dailyWon: 0,
    currentStreak: 0,
    bestStreak: 0,
    dailyHistory: {},
    dailyAnswers: {},
    dailyEmbedUrls: {},
    randomPlayed: 0,
    randomWon: 0,
};

function canUseStorage(): boolean {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function makeDailyStorageKey(dateKey: string, artistSelectionKey = "all-artists"): string {
    return `${dateKey}::${artistSelectionKey}`;
}

export function getStats(): HeardleStats {
    if (!canUseStorage()) {
        return DEFAULT_STATS;
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);

        if (!raw) {
            return DEFAULT_STATS;
        }

        const parsed = JSON.parse(raw) as HeardleStats;

        return {
            ...DEFAULT_STATS,
            ...parsed,
            dailyHistory: parsed.dailyHistory ?? {},
            dailyAnswers: parsed.dailyAnswers ?? {},
            dailyEmbedUrls: parsed.dailyEmbedUrls ?? {},
        };
    } catch {
        return DEFAULT_STATS;
    }
}

export function hasPlayedDaily(dateKey: string, artistSelectionKey?: string): boolean {
    const stats = getStats();
    return Boolean(stats.dailyHistory[makeDailyStorageKey(dateKey, artistSelectionKey)]);
}

export function getDailyAnswer(dateKey: string, artistSelectionKey?: string): string | null {
    const stats = getStats();
    return stats.dailyAnswers[makeDailyStorageKey(dateKey, artistSelectionKey)] ?? null;
}

export function getDailyEmbedUrl(dateKey: string, artistSelectionKey?: string): string | null {
    const stats = getStats();
    return stats.dailyEmbedUrls[makeDailyStorageKey(dateKey, artistSelectionKey)] ?? null;
}

export function recordGameResult(params: {
    mode: GameMode;
    won: boolean;
    dateKey?: string;
    artistSelectionKey?: string;
    answerTitle?: string | null;
    soundcloudUrl?: string | null;
}): HeardleStats {
    const next = getStats();

    if (params.mode === "daily" && params.dateKey) {
        const dailyKey = makeDailyStorageKey(params.dateKey, params.artistSelectionKey);
        const existing = next.dailyHistory[dailyKey];

        if (params.answerTitle) {
            next.dailyAnswers[dailyKey] = params.answerTitle;
        }

        if (params.soundcloudUrl) {
            next.dailyEmbedUrls[dailyKey] = params.soundcloudUrl;
        }

        if (existing) {
            if (canUseStorage()) {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            }
            return next;
        }

        next.dailyHistory[dailyKey] = params.won ? "won" : "lost";
        next.dailyPlayed += 1;

        if (params.won) {
            next.dailyWon += 1;
        }
    }

    next.totalPlayed += 1;

    if (params.won) {
        next.totalWon += 1;
        next.currentStreak += 1;
        next.bestStreak = Math.max(next.bestStreak, next.currentStreak);
    } else {
        next.currentStreak = 0;
    }

    if (params.mode === "random") {
        next.randomPlayed += 1;

        if (params.won) {
            next.randomWon += 1;
        }
    }

    if (canUseStorage()) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }

    return next;
}
