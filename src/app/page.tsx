"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ModeSwitch } from "@/components/ModeSwitch";
import {
  SoundCloudPlayer,
  type SoundCloudPlayerHandle,
} from "@/components/SoundCloudPlayer";
import { getUtcDateKey, type GameMode } from "@/lib/game";
import {
  ARTIST_OPTIONS,
  isArtistId,
  makeArtistSelectionKey,
  type ArtistId,
} from "@/lib/songs";
import {
  getDailyAnswer,
  getDailyEmbedUrl,
  getStats,
  hasPlayedDaily,
  recordGameResult,
  type HeardleStats,
} from "@/lib/storage";

type SessionData = {
  mode: GameMode;
  token: string;
  dateKey: string;
  roundDurationsMs: number[];
  soundcloudUrl: string;
  previewStartMs: number;
};

type GuessResponse = {
  correct: boolean;
  finished: boolean;
  answerTitle: string | null;
};

type CatalogOption = {
  title: string;
  artistId: ArtistId;
  artistLabel: string;
};

type ProviderStatusResponse = {
  activeProvider: string;
  rateLimited: boolean;
  rateLimitUntilIso: string | null;
  message: string | null;
};

const EMPTY_STATS: HeardleStats = {
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

const ARTIST_STORAGE_KEY = "heardle:selected-artists:v1";
const DEFAULT_SELECTED_ARTISTS: ArtistId[] = ARTIST_OPTIONS.map((option) => option.id);
const DAILY_ARTISTS: ArtistId[] = ["conan-gray"];
const DAILY_ARTIST_SELECTION_KEY = makeArtistSelectionKey(DAILY_ARTISTS);

export default function Home() {
  const clipFallbackTimeoutRef = useRef<number | null>(null);
  const playerRef = useRef<SoundCloudPlayerHandle | null>(null);
  const [mode, setMode] = useState<GameMode>("daily");
  const [status, setStatus] = useState<"idle" | "loading" | "active" | "won" | "lost">("idle");
  const [session, setSession] = useState<SessionData | null>(null);
  const [round, setRound] = useState(1);
  const [guessInput, setGuessInput] = useState("");
  const [guesses, setGuesses] = useState<string[]>([]);
  const [answerTitle, setAnswerTitle] = useState<string | null>(null);
  const [isClipPlaying, setIsClipPlaying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dailyLocked, setDailyLocked] = useState(false);
  const [stats, setStats] = useState<HeardleStats>(EMPTY_STATS);
  const [catalogOptions, setCatalogOptions] = useState<CatalogOption[]>([]);
  const [resultCommitted, setResultCommitted] = useState(false);
  const [todayDailyAnswer, setTodayDailyAnswer] = useState<string | null>(null);
  const [todayDailyEmbedUrl, setTodayDailyEmbedUrl] = useState<string | null>(null);
  const [selectedArtists, setSelectedArtists] = useState<ArtistId[]>(DEFAULT_SELECTED_ARTISTS);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse | null>(null);
  const artistSelectionKey = useMemo(() => makeArtistSelectionKey(selectedArtists), [selectedArtists]);

  function toSoundCloudEmbedUrl(soundcloudUrl: string): string {
    const params = new URLSearchParams({
      url: soundcloudUrl,
      auto_play: "false",
      hide_related: "true",
      show_comments: "false",
      show_user: "true",
      show_reposts: "false",
      show_teaser: "true",
      visual: "true",
      color: "ff5500",
    });

    return `https://w.soundcloud.com/player/?${params.toString()}`;
  }

  function getArtistsQueryValue(): string {
    return selectedArtists.join(",");
  }

  function loadSelectedArtists(): ArtistId[] {
    if (typeof window === "undefined") {
      return DEFAULT_SELECTED_ARTISTS;
    }

    try {
      const raw = window.localStorage.getItem(ARTIST_STORAGE_KEY);

      if (!raw) {
        return DEFAULT_SELECTED_ARTISTS;
      }

      const parsed = JSON.parse(raw) as string[];
      const filtered = parsed.filter((value): value is ArtistId => isArtistId(value));
      return filtered.length > 0 ? filtered : DEFAULT_SELECTED_ARTISTS;
    } catch {
      return DEFAULT_SELECTED_ARTISTS;
    }
  }

  async function loadTodayDailyEmbed() {
    try {
      const params = new URLSearchParams({ mode: "daily", artists: DAILY_ARTISTS.join(",") });
      const response = await fetch(`/api/game?${params.toString()}`);

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as SessionData;
      setTodayDailyEmbedUrl(data.soundcloudUrl);
    } catch {
      setTodayDailyEmbedUrl(null);
    }
  }

  async function refreshCatalog(artists: ArtistId[]) {
    try {
      const params = new URLSearchParams({ artists: artists.join(",") });
      const response = await fetch(`/api/catalog?${params.toString()}`);

      if (!response.ok) {
        setCatalogOptions([]);
        return;
      }

      const data = (await response.json()) as { entries?: CatalogOption[] };
      setCatalogOptions(data.entries ?? []);
    } catch {
      setCatalogOptions([]);
    } finally {
      void refreshProviderStatus();
    }
  }

  async function refreshProviderStatus(clearOnError = false) {
    try {
      const response = await fetch("/api/provider-status", {
        cache: "no-store",
      });

      if (!response.ok) {
        if (clearOnError) {
          setProviderStatus(null);
        }
        return;
      }

      const data = (await response.json()) as ProviderStatusResponse;
      setProviderStatus(data);
    } catch {
      if (clearOnError) {
        setProviderStatus(null);
      }
    }
  }

  useEffect(() => {
    const currentArtists = loadSelectedArtists();
    const todayKey = getUtcDateKey();
    const alreadyPlayed = hasPlayedDaily(todayKey, DAILY_ARTIST_SELECTION_KEY);
    const storedEmbedUrl = getDailyEmbedUrl(todayKey, DAILY_ARTIST_SELECTION_KEY);

    setSelectedArtists(currentArtists);
    setStats(getStats());
    setDailyLocked(alreadyPlayed);
    setTodayDailyAnswer(getDailyAnswer(todayKey, DAILY_ARTIST_SELECTION_KEY));
    setTodayDailyEmbedUrl(storedEmbedUrl);

    if (alreadyPlayed && !storedEmbedUrl) {
      void loadTodayDailyEmbed();
    }

    void refreshCatalog(currentArtists);
    void refreshProviderStatus(true);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshProviderStatus();
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ARTIST_STORAGE_KEY, JSON.stringify(selectedArtists));
    }

    void refreshCatalog(selectedArtists);

    if (mode === "daily" && dailyLocked && !todayDailyEmbedUrl) {
      void loadTodayDailyEmbed();
    }
  }, [selectedArtists]);

  useEffect(() => {
    if (mode !== "daily") {
      setDailyLocked(false);
      return;
    }

    const todayKey = getUtcDateKey();
    const alreadyPlayed = hasPlayedDaily(todayKey, DAILY_ARTIST_SELECTION_KEY);
    const storedEmbedUrl = getDailyEmbedUrl(todayKey, DAILY_ARTIST_SELECTION_KEY);

    setDailyLocked(alreadyPlayed);
    setTodayDailyAnswer(getDailyAnswer(todayKey, DAILY_ARTIST_SELECTION_KEY));
    setTodayDailyEmbedUrl(storedEmbedUrl);

    if (alreadyPlayed && !storedEmbedUrl) {
      void loadTodayDailyEmbed();
    }
  }, [mode]);

  useEffect(() => {
    if (!session) {
      return;
    }

    setSession(null);
    setStatus("idle");
    setRound(1);
    setGuesses([]);
    setGuessInput("");
    setAnswerTitle(null);
    setIsClipPlaying(false);
    setResultCommitted(false);
  }, [artistSelectionKey]);

  useEffect(() => {
    if (!session) {
      return;
    }

    if (session.mode !== mode) {
      setSession(null);
      setStatus("idle");
      setRound(1);
      setGuesses([]);
      setGuessInput("");
      setAnswerTitle(null);
      setIsClipPlaying(false);
      setResultCommitted(false);
      return;
    }

    if (session.mode === "daily" && session.dateKey !== getUtcDateKey()) {
      setSession(null);
      setStatus("idle");
      setRound(1);
      setGuesses([]);
      setGuessInput("");
      setAnswerTitle(null);
      setIsClipPlaying(false);
      setResultCommitted(false);
      return;
    }

    if (session.mode === "random") {
      return;
    }
  }, [artistSelectionKey, mode, session]);

  useEffect(() => {
    if (!session || resultCommitted) {
      return;
    }

    if (status !== "won" && status !== "lost") {
      return;
    }

    const nextStats = recordGameResult({
      mode: session.mode,
      won: status === "won",
      dateKey: session.mode === "daily" ? session.dateKey : undefined,
      artistSelectionKey: session.mode === "daily" ? DAILY_ARTIST_SELECTION_KEY : artistSelectionKey,
      answerTitle,
      soundcloudUrl: session.soundcloudUrl,
    });

    setStats(nextStats);
    setResultCommitted(true);

    if (session.mode === "daily") {
      setDailyLocked(true);
      setTodayDailyAnswer(answerTitle);
      setTodayDailyEmbedUrl(session.soundcloudUrl);
    }
  }, [artistSelectionKey, resultCommitted, session, status]);

  useEffect(() => {
    return () => {
      if (clipFallbackTimeoutRef.current) {
        window.clearTimeout(clipFallbackTimeoutRef.current);
      }
    };
  }, []);

  const activeRoundDuration = useMemo(() => {
    if (!session) {
      return 1000;
    }

    return session.roundDurationsMs[Math.max(0, Math.min(round - 1, session.roundDurationsMs.length - 1))];
  }, [round, session]);

  const canPlay = status === "active" && session && !isClipPlaying;
  const canSubmitGuess = status === "active" && guessInput.trim().length > 0;
  const isComplete = status === "won" || status === "lost";
  const dailyWinRate = stats.dailyPlayed > 0 ? Math.round((stats.dailyWon / stats.dailyPlayed) * 100) : 0;
  const randomWinRate = stats.randomPlayed > 0 ? Math.round((stats.randomWon / stats.randomPlayed) * 100) : 0;

  async function startGame() {
    setErrorMessage(null);

    if (mode === "daily" && hasPlayedDaily(getUtcDateKey(), DAILY_ARTIST_SELECTION_KEY)) {
      setDailyLocked(true);
      setErrorMessage("You already played today’s daily puzzle. Try random mode.");
      setTodayDailyAnswer(getDailyAnswer(getUtcDateKey(), DAILY_ARTIST_SELECTION_KEY));
      const storedEmbedUrl = getDailyEmbedUrl(getUtcDateKey(), DAILY_ARTIST_SELECTION_KEY);
      setTodayDailyEmbedUrl(storedEmbedUrl);

      if (!storedEmbedUrl) {
        void loadTodayDailyEmbed();
      }
      return;
    }

    setStatus("loading");

    try {
      const artists = mode === "daily" ? DAILY_ARTISTS.join(",") : getArtistsQueryValue();
      const params = new URLSearchParams({ mode, artists });
      const response = await fetch(`/api/game?${params.toString()}`);

      if (!response.ok) {
        let message = "Could not create game session.";

        try {
          const errorData = (await response.json()) as { error?: string };
          message = errorData.error ?? message;
        } catch {
        }

        throw new Error(message);
      }

      const data = (await response.json()) as SessionData;
      setSession(data);
      setRound(1);
      setGuesses([]);
      setGuessInput("");
      setAnswerTitle(null);
      setIsClipPlaying(false);
      setResultCommitted(false);
      setStatus("active");
      void refreshProviderStatus();
    } catch (error) {
      setStatus("idle");
      setErrorMessage(error instanceof Error ? error.message : "Could not start game. Please try again.");
      void refreshProviderStatus();
    }
  }

  async function submitGuess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || status !== "active") {
      return;
    }

    const currentGuess = guessInput.trim();

    if (!currentGuess) {
      return;
    }

    setErrorMessage(null);
    setGuesses((previous) => [...previous, currentGuess]);

    try {
      const response = await fetch("/api/guess", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: session.token,
          guess: currentGuess,
          round,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error ?? "Guess failed.");
      }

      const result = (await response.json()) as GuessResponse;
      setGuessInput("");

      if (result.correct) {
        setStatus("won");
        setAnswerTitle(result.answerTitle);
        return;
      }

      if (result.finished || round >= 6) {
        setStatus("lost");
        setAnswerTitle(result.answerTitle);
        return;
      }

      setRound((value) => Math.min(6, value + 1));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Guess failed.");
    }
  }

  function playClip() {
    if (!canPlay) {
      return;
    }

    if (clipFallbackTimeoutRef.current) {
      window.clearTimeout(clipFallbackTimeoutRef.current);
      clipFallbackTimeoutRef.current = null;
    }

    setErrorMessage(null);
    setIsClipPlaying(true);
    const started = playerRef.current?.requestPlayback() ?? false;

    if (!started) {
      setIsClipPlaying(false);
      setErrorMessage("Player is loading. Press Play Clip again in a second.");
      return;
    }

    clipFallbackTimeoutRef.current = window.setTimeout(() => {
      setIsClipPlaying(false);
    }, activeRoundDuration + 2500);
  }

  function skipRound() {
    if (status !== "active") {
      return;
    }

    setGuesses((previous) => [...previous, "(Skipped)"]);

    if (round >= 6) {
      setStatus("lost");
      return;
    }

    setRound((value) => Math.min(6, value + 1));
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Heardle</h1>
        <p className="text-sm text-black/70 dark:text-white/70">
          Guess the song using short SoundCloud clips. Daily uses a UTC reset.
        </p>
      </header>

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/20 dark:bg-black/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ModeSwitch
            mode={mode}
            disabled={status === "loading" || status === "active"}
            onChange={(nextMode) => {
              setMode(nextMode);
              setErrorMessage(null);
            }}
          />
          <button
            type="button"
            onClick={startGame}
            disabled={status === "loading" || (mode === "daily" && dailyLocked)}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {status === "loading" ? "Loading…" : "Start"}
          </button>
        </div>

        {mode === "random" ? (
          <details className="mt-3 rounded-lg border border-black/10 bg-black/5 p-3 dark:border-white/20 dark:bg-white/10">
            <summary className="cursor-pointer text-sm font-semibold">Settings · Artists ({selectedArtists.length})</summary>
            <div className="mt-3 grid gap-2 text-sm">
              {ARTIST_OPTIONS.map((artistOption) => {
                const checked = selectedArtists.includes(artistOption.id);
                const disableUncheck = checked && selectedArtists.length === 1;

                return (
                  <label key={artistOption.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disableUncheck}
                      onChange={(event) => {
                        const enabled = event.target.checked;

                        setSelectedArtists((current) => {
                          if (enabled) {
                            return current.includes(artistOption.id) ? current : [...current, artistOption.id];
                          }

                          const next = current.filter((artistId) => artistId !== artistOption.id);
                          return next.length > 0 ? next : current;
                        });
                      }}
                    />
                    <span>{artistOption.label}</span>
                  </label>
                );
              })}
            </div>
          </details>
        ) : (
          <p className="mt-3 text-sm text-black/70 dark:text-white/70">Daily mode is Conan Gray only.</p>
        )}

        {errorMessage ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
            {errorMessage}
          </p>
        ) : null}

        {providerStatus?.activeProvider === "soundcloud" && providerStatus.rateLimited ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {providerStatus.message ?? "SoundCloud is currently rate-limited. Cached/static tracks are being used."}
          </p>
        ) : null}

        {mode === "daily" && dailyLocked ? (
          <div className="mt-3 space-y-3">
            {todayDailyAnswer ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                Today’s daily song: {todayDailyAnswer}
              </p>
            ) : (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                You already played today’s daily.
              </p>
            )}
            {todayDailyEmbedUrl ? (
              <iframe
                title="Today's daily SoundCloud song"
                width="100%"
                height="300"
                allow="autoplay"
                src={toSoundCloudEmbedUrl(todayDailyEmbedUrl)}
                className="w-full rounded-xl border border-black/10 bg-white"
              />
            ) : null}
          </div>
        ) : null}

        {session ? (
          <div className="mt-5 space-y-4">
            {!(session.mode === "daily" && isComplete) ? (
              <SoundCloudPlayer
                ref={playerRef}
                soundcloudUrl={session.soundcloudUrl}
                revealMetadata={isComplete}
                clipStartMs={session.previewStartMs}
                clipDurationMs={activeRoundDuration}
                disabled={!canPlay}
                onClipFinished={() => {
                  if (clipFallbackTimeoutRef.current) {
                    window.clearTimeout(clipFallbackTimeoutRef.current);
                    clipFallbackTimeoutRef.current = null;
                  }
                  setIsClipPlaying(false);
                }}
              />
            ) : null}

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-md bg-black/5 px-2 py-1 dark:bg-white/10">
                Round {round} / 6
              </span>
              <span className="rounded-md bg-black/5 px-2 py-1 dark:bg-white/10">
                Clip {Math.floor(activeRoundDuration / 1000)}s
              </span>
              {session.mode === "daily" ? (
                <span className="rounded-md bg-black/5 px-2 py-1 dark:bg-white/10">Daily: {session.dateKey}</span>
              ) : (
                <span className="rounded-md bg-black/5 px-2 py-1 dark:bg-white/10">Random Mode</span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={playClip}
                disabled={!canPlay}
                className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20"
              >
                {isClipPlaying ? "Playing…" : "Play Clip"}
              </button>
              <button
                type="button"
                onClick={skipRound}
                disabled={status !== "active"}
                className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20"
              >
                Skip
              </button>
            </div>

            <form onSubmit={submitGuess} className="space-y-2">
              <label htmlFor="guess" className="block text-sm font-semibold">
                Song guess
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="guess"
                  list="song-catalog"
                  value={guessInput}
                  onChange={(event) => setGuessInput(event.target.value)}
                  disabled={status !== "active"}
                  placeholder="Type a song title"
                  className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none ring-0 placeholder:text-black/40 focus:border-black/35 dark:border-white/20 dark:placeholder:text-white/40 dark:focus:border-white/40"
                />
                <button
                  type="submit"
                  disabled={!canSubmitGuess}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
                >
                  Guess
                </button>
              </div>
              <datalist id="song-catalog">
                {catalogOptions.map((entry, index) => (
                  <option
                    key={`${entry.title}-${entry.artistId}-${index}`}
                    value={entry.title}
                    label={selectedArtists.length > 1 ? `${entry.title} — ${entry.artistLabel}` : entry.title}
                  />
                ))}
              </datalist>
            </form>

            {guesses.length > 0 ? (
              <ul className="grid gap-2 text-sm">
                {guesses.map((guess, index) => (
                  <li key={`${guess}-${index}`} className="rounded-md bg-black/5 px-3 py-2 dark:bg-white/10">
                    Attempt {index + 1}: {guess}
                  </li>
                ))}
              </ul>
            ) : null}

            {status === "won" ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                Correct! {answerTitle ? `It was ${answerTitle}.` : ""}
              </p>
            ) : null}

            {status === "lost" ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                Out of rounds. {answerTitle ? `The song was ${answerTitle}.` : "Game over."}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-black/70 dark:text-white/70">
            Start a game to load a SoundCloud clip.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/20 dark:bg-black/30">
        <h2 className="text-lg font-semibold">Local Stats</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div className="rounded-lg bg-black/5 p-3 dark:bg-white/10">
            <p className="text-black/60 dark:text-white/60">Daily Played</p>
            <p className="text-xl font-semibold">{stats.dailyPlayed}</p>
          </div>
          <div className="rounded-lg bg-black/5 p-3 dark:bg-white/10">
            <p className="text-black/60 dark:text-white/60">Daily Win Rate</p>
            <p className="text-xl font-semibold">{dailyWinRate}%</p>
          </div>
          <div className="rounded-lg bg-black/5 p-3 dark:bg-white/10">
            <p className="text-black/60 dark:text-white/60">Random Played</p>
            <p className="text-xl font-semibold">{stats.randomPlayed}</p>
          </div>
          <div className="rounded-lg bg-black/5 p-3 dark:bg-white/10">
            <p className="text-black/60 dark:text-white/60">Random Win Rate</p>
            <p className="text-xl font-semibold">{randomWinRate}%</p>
          </div>
        </div>
      </section>
    </main>
  );
}
