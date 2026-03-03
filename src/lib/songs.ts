import { createHash } from "node:crypto";
import { normalizeGuess } from "./game";

export const ARTIST_OPTIONS = [
    { id: "conan-gray", label: "Conan Gray" },
    { id: "twenty-one-pilots", label: "Twenty One Pilots" },
    { id: "kanye-west", label: "Kanye West" },
] as const;

export type ArtistId = (typeof ARTIST_OPTIONS)[number]["id"];

export type Song = {
    id: string;
    artist: ArtistId;
    title: string;
    aliases: string[];
    soundcloudUrl: string;
    previewStartMs: number;
};

export const SONGS: Song[] = [
    {
        id: "maniac",
        artist: "conan-gray",
        title: "Maniac",
        aliases: ["maniac"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/maniac",
        previewStartMs: 9000,
    },
    {
        id: "heather",
        artist: "conan-gray",
        title: "Heather",
        aliases: ["heather"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/heather",
        previewStartMs: 18000,
    },
    {
        id: "memories",
        artist: "conan-gray",
        title: "Memories",
        aliases: ["memories"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/memories",
        previewStartMs: 12000,
    },
    {
        id: "people-watching",
        artist: "conan-gray",
        title: "People Watching",
        aliases: ["people watching"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/people-watching",
        previewStartMs: 15000,
    },
    {
        id: "yours",
        artist: "conan-gray",
        title: "Yours",
        aliases: ["yours"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/yours",
        previewStartMs: 14000,
    },
    {
        id: "astronomy",
        artist: "conan-gray",
        title: "Astronomy",
        aliases: ["astronomy"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/astronomy",
        previewStartMs: 16000,
    },
    {
        id: "disaster",
        artist: "conan-gray",
        title: "Disaster",
        aliases: ["disaster"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/disaster",
        previewStartMs: 10500,
    },
    {
        id: "telepath",
        artist: "conan-gray",
        title: "Telepath",
        aliases: ["telepath"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/telepath",
        previewStartMs: 13000,
    },
    {
        id: "family-line",
        artist: "conan-gray",
        title: "Family Line",
        aliases: ["family line"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/family-line",
        previewStartMs: 19000,
    },
    {
        id: "the-exit",
        artist: "conan-gray",
        title: "The Exit",
        aliases: ["the exit", "exit"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/the-exit",
        previewStartMs: 10000,
    },
    {
        id: "never-ending-song",
        artist: "conan-gray",
        title: "Never Ending Song",
        aliases: ["never ending song"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/never-ending-song",
        previewStartMs: 9000,
    },
    {
        id: "winner",
        artist: "conan-gray",
        title: "Winner",
        aliases: ["winner"],
        soundcloudUrl: "https://soundcloud.com/conan-gray/winner",
        previewStartMs: 12000,
    },
    {
        id: "stressed-out",
        artist: "twenty-one-pilots",
        title: "Stressed Out",
        aliases: ["stressed out"],
        soundcloudUrl: "https://soundcloud.com/twentyonepilots/stressed-out",
        previewStartMs: 11000,
    },
    {
        id: "ride",
        artist: "twenty-one-pilots",
        title: "Ride",
        aliases: ["ride"],
        soundcloudUrl: "https://soundcloud.com/twentyonepilots/ride",
        previewStartMs: 13000,
    },
    {
        id: "heathens",
        artist: "twenty-one-pilots",
        title: "Heathens",
        aliases: ["heathens"],
        soundcloudUrl: "https://soundcloud.com/twentyonepilots/heathens",
        previewStartMs: 12000,
    },
    {
        id: "chlorine",
        artist: "twenty-one-pilots",
        title: "Chlorine",
        aliases: ["chlorine"],
        soundcloudUrl: "https://soundcloud.com/twentyonepilots/chlorine",
        previewStartMs: 15000,
    },
    {
        id: "stronger",
        artist: "kanye-west",
        title: "Stronger",
        aliases: ["stronger"],
        soundcloudUrl: "https://soundcloud.com/kanyewest/stronger",
        previewStartMs: 10000,
    },
    {
        id: "gold-digger",
        artist: "kanye-west",
        title: "Gold Digger",
        aliases: ["gold digger"],
        soundcloudUrl: "https://soundcloud.com/kanyewest/gold-digger",
        previewStartMs: 11000,
    },
    {
        id: "heartless",
        artist: "kanye-west",
        title: "Heartless",
        aliases: ["heartless"],
        soundcloudUrl: "https://soundcloud.com/kanyewest/heartless",
        previewStartMs: 13000,
    },
    {
        id: "bound-2",
        artist: "kanye-west",
        title: "Bound 2",
        aliases: ["bound 2", "bound two"],
        soundcloudUrl: "https://soundcloud.com/kanyewest/bound-2",
        previewStartMs: 14000,
    },
];

export function isArtistId(value: string): value is ArtistId {
    return ARTIST_OPTIONS.some((option) => option.id === value);
}

export function filterSongsByArtists(artists: ArtistId[]): Song[] {
    if (artists.length === 0) {
        return SONGS;
    }

    const selected = new Set(artists);
    return SONGS.filter((song) => selected.has(song.artist));
}

export function makeArtistSelectionKey(artists: ArtistId[]): string {
    if (artists.length === 0) {
        return "all-artists";
    }

    return [...artists].sort((left, right) => left.localeCompare(right)).join("|");
}

const ARTIST_LABEL_BY_ID = new Map(ARTIST_OPTIONS.map((option) => [option.id, option.label]));

export type CatalogEntry = {
    title: string;
    artistId: ArtistId;
    artistLabel: string;
};

export function getCatalogEntries(artists: ArtistId[] = []): CatalogEntry[] {
    return filterSongsByArtists(artists)
        .map((song) => ({
            title: song.title,
            artistId: song.artist,
            artistLabel: ARTIST_LABEL_BY_ID.get(song.artist) ?? song.artist,
        }))
        .sort((left, right) => {
            const byTitle = left.title.localeCompare(right.title);
            return byTitle !== 0 ? byTitle : left.artistLabel.localeCompare(right.artistLabel);
        });
}

export function getSongById(songId: string): Song | undefined {
    return SONGS.find((song) => song.id === songId);
}

export function getCatalogTitles(artists: ArtistId[] = []): string[] {
    return filterSongsByArtists(artists)
        .map((song) => song.title)
        .sort((a, b) => a.localeCompare(b));
}

export function isCorrectGuess(song: Song, guess: string): boolean {
    const normalizedGuess = normalizeGuess(guess);
    const accepted = [song.title, ...song.aliases].map((value) => normalizeGuess(value));
    return accepted.includes(normalizedGuess);
}

export function pickRandomSong(excludeSongId?: string, artists: ArtistId[] = []): Song {
    const candidates = filterSongsByArtists(artists);
    const pool = excludeSongId ? candidates.filter((song) => song.id !== excludeSongId) : candidates;
    const source = pool.length > 0 ? pool : candidates;
    const index = Math.floor(Math.random() * source.length);
    return source[index];
}

export function pickDailySong(dateKey: string, artists: ArtistId[] = []): Song {
    const candidates = filterSongsByArtists(artists);
    const artistKey = makeArtistSelectionKey(artists);
    const digest = createHash("sha256").update(`heardle-${artistKey}-${dateKey}`).digest("hex");
    const numeric = Number.parseInt(digest.slice(0, 8), 16);
    const index = numeric % candidates.length;
    return candidates[index];
}
