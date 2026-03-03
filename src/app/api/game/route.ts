import { NextResponse } from "next/server";
import { getUtcDateKey, ROUND_DURATIONS_MS, type GameMode } from "@/lib/game";
import { getSongProvider } from "@/lib/song-provider";
import { isArtistId, type ArtistId } from "@/lib/songs";
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

export async function GET(request: Request) {
    const songProvider = getSongProvider();
    const { searchParams } = new URL(request.url);
    const modeParam = searchParams.get("mode");
    const selectedArtists = parseArtists(searchParams);
    const mode: GameMode = modeParam === "random" ? "random" : "daily";

    const dateKey = getUtcDateKey();
    const song =
        mode === "daily"
            ? await songProvider.pickDailySong(dateKey, selectedArtists)
            : await songProvider.pickRandomSong(undefined, selectedArtists);

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
