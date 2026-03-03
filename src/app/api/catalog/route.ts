import { NextResponse } from "next/server";
import { getSongProvider } from "@/lib/song-provider";
import { isArtistId, type ArtistId } from "@/lib/songs";

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
    const selectedArtists = parseArtists(searchParams);

    return NextResponse.json({
        titles: await songProvider.getCatalogTitles(selectedArtists),
        entries: await songProvider.getCatalogEntries(selectedArtists),
    });
}
