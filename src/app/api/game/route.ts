import { NextResponse } from "next/server";
import { getUtcDateKey, ROUND_DURATIONS_MS, type GameMode } from "@/lib/game";
import { getSongProvider } from "@/lib/song-provider";
import { isArtistId, type ArtistId, type Song } from "@/lib/songs";
import { signPuzzleToken } from "@/lib/token";

function parseArtists(searchParams: URLSearchParams): ArtistId[] {
    const artistsParam = searchParams.get("artists");

    if (!artistsParam) {
        return [];
    }

    return artistsParam
        .split(",")
        .map((value) => value.trim())
        .filter((value): value is ArtistId => isArtistId(value));
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }

    return "Could not create game session.";
}

function isRateLimitedMessage(message: string): boolean {
    return /rate[- ]limited/i.test(message);
}

export async function GET(request: Request) {
    const songProvider = getSongProvider();
    const { searchParams } = new URL(request.url);
    const modeParam = searchParams.get("mode");
    const selectedArtists = parseArtists(searchParams);
    const mode: GameMode = modeParam === "random" ? "random" : "daily";

    const dateKey = getUtcDateKey();
    let song: Song;

    try {
        song =
            mode === "daily"
                ? await songProvider.pickDailySong(dateKey, selectedArtists)
                : await songProvider.pickRandomSong(undefined, selectedArtists);
    } catch (error) {
        const message = getErrorMessage(error);
        const rateLimited = isRateLimitedMessage(message);

        return NextResponse.json(
            {
                error: message,
                code: rateLimited ? "RATE_LIMITED" : "SESSION_CREATE_FAILED",
            },
            {
                status: rateLimited ? 429 : 500,
            }
        );
    }

    const token = signPuzzleToken({
        songId: song.id,
        mode,
        dateKey: mode === "daily" ? dateKey : undefined,
        issuedAt: Date.now(),
    });

    return NextResponse.json({
        mode,
        token,
        dateKey,
        roundDurationsMs: ROUND_DURATIONS_MS,
        soundcloudUrl: song.soundcloudUrl,
        previewStartMs: song.previewStartMs,
    });
}
