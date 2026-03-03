"use client";

import type { GameMode } from "@/lib/game";

type Props = {
    mode: GameMode;
    onChange: (mode: GameMode) => void;
    disabled?: boolean;
};

export function ModeSwitch({ mode, onChange, disabled }: Props) {
    const base = "rounded-lg px-4 py-2 text-sm font-semibold transition";

    return (
        <div className="inline-flex rounded-xl border border-black/10 bg-white p-1 dark:border-white/20 dark:bg-black/20">
            <button
                type="button"
                className={`${base} ${mode === "daily" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"}`}
                disabled={disabled}
                onClick={() => onChange("daily")}
            >
                Daily
            </button>
            <button
                type="button"
                className={`${base} ${mode === "random" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"}`}
                disabled={disabled}
                onClick={() => onChange("random")}
            >
                Random
            </button>
        </div>
    );
}
