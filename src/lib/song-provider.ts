import { createHash } from "node:crypto";
import {
    ARTIST_OPTIONS,
    getCatalogEntries,
    getCatalogTitles,
    getSongById,
    isCorrectGuess,
    makeArtistSelectionKey,
    pickDailySong,
    pickRandomSong,
    type ArtistId,
    type CatalogEntry,
    type Song,
} from "./songs";

type Awaitable<T> = T | Promise<T>;

export type SongProvider = {
    id: "static" | "spotify" | "soundcloud";
    getSongById: (songId: string) => Awaitable<Song | undefined>;
    isCorrectGuess: (song: Song, guess: string) => Awaitable<boolean>;
    getCatalogTitles: (artists?: ArtistId[]) => Awaitable<string[]>;
    getCatalogEntries: (artists?: ArtistId[]) => Awaitable<CatalogEntry[]>;
    pickRandomSong: (excludeSongId?: string, artists?: ArtistId[]) => Awaitable<Song>;
    pickDailySong: (dateKey: string, artists?: ArtistId[]) => Awaitable<Song>;
};

const staticSongProvider: SongProvider = {
    id: "static",
    getSongById: (songId) => getSongById(songId),
    isCorrectGuess: (song, guess) => isCorrectGuess(song, guess),
    getCatalogTitles: (artists = []) => getCatalogTitles(artists),
    getCatalogEntries: (artists = []) => getCatalogEntries(artists),
    pickRandomSong: (excludeSongId, artists = []) => pickRandomSong(excludeSongId, artists),
    pickDailySong: (dateKey, artists = []) => pickDailySong(dateKey, artists),
};

function createSpotifySongProvider(): SongProvider {
    return {
        ...staticSongProvider,
        id: "spotify",
    };
}

const DEFAULT_SOUNDCLOUD_PERMALINKS: Record<ArtistId, string> = {
    "conan-gray": "conan-gray",
    "twenty-one-pilots": "twentyonepilots",
    "kanye-west": "kanyewest",
};

const ARTIST_LABEL_BY_ID = new Map(ARTIST_OPTIONS.map((option) => [option.id, option.label]));
const SOUNDCLOUD_CACHE_TTL_MS = Number.parseInt(process.env.HEARDLE_SOUNDCLOUD_CACHE_TTL_MS ?? "900000", 10);
const SOUNDCLOUD_DEFAULT_PREVIEW_START_MS = 12000;
const SOUNDCLOUD_END_BUFFER_MS = 20000;

type SoundCloudResolveResponse = {
    id: number;
    permalink?: string;
};

type SoundCloudTrack = {
    id: number;
    title: string;
    permalink_url: string;
    duration?: number;
};

type SoundCloudTracksResponse = {
    collection: SoundCloudTrack[];
    next_href?: string;
};

type CachedSongs = {
    songs: Song[];
    expiresAt: number;
};

type SoundCloudProviderOptions = {
    clientId: string;
};

function getSoundCloudPermalink(artist: ArtistId): string {
    const envSuffix = artist.toUpperCase().replace(/-/g, "_");
    const override = process.env[`HEARDLE_SOUNDCLOUD_${envSuffix}_PERMALINK`];
    return override?.trim() || DEFAULT_SOUNDCLOUD_PERMALINKS[artist];
}

function withClientId(url: string, clientId: string): string {
    const parsed = new URL(url);

    if (!parsed.searchParams.has("client_id")) {
        parsed.searchParams.set("client_id", clientId);
    }

    if (!parsed.searchParams.has("linked_partitioning")) {
        parsed.searchParams.set("linked_partitioning", "1");
    }

    return parsed.toString();
}

function toPreviewStartMs(durationMs?: number): number {
    if (!durationMs || durationMs <= 0) {
        return SOUNDCLOUD_DEFAULT_PREVIEW_START_MS;
    }

    const maxStart = Math.max(0, durationMs - SOUNDCLOUD_END_BUFFER_MS);
    return Math.min(SOUNDCLOUD_DEFAULT_PREVIEW_START_MS, maxStart);
}

function parseSoundCloudTrackToSong(track: SoundCloudTrack, artist: ArtistId): Song | null {
    if (!track?.id || !track?.title || !track?.permalink_url) {
        return null;
    }

    return {
        id: `sc-${track.id}`,
        artist,
        title: track.title,
        aliases: [track.title],
        soundcloudUrl: track.permalink_url,
        previewStartMs: toPreviewStartMs(track.duration),
    };
}

function sortSongsByTitle(songs: Song[]): Song[] {
    return [...songs].sort((left, right) => {
        const byTitle = left.title.localeCompare(right.title);
        return byTitle !== 0 ? byTitle : left.id.localeCompare(right.id);
    });
}

function pickDailyFromSongs(dateKey: string, songs: Song[], artists: ArtistId[]): Song {
    const artistKey = makeArtistSelectionKey(artists);
    const digest = createHash("sha256").update(`heardle-soundcloud-${artistKey}-${dateKey}`).digest("hex");
    const numeric = Number.parseInt(digest.slice(0, 8), 16);
    const index = numeric % songs.length;
    return songs[index];
}

function pickRandomFromSongs(songs: Song[], excludeSongId?: string): Song {
    const pool = excludeSongId ? songs.filter((song) => song.id !== excludeSongId) : songs;
    const source = pool.length > 0 ? pool : songs;
    const index = Math.floor(Math.random() * source.length);
    return source[index];
}

function createSoundCloudSongProvider(options: SoundCloudProviderOptions): SongProvider {
    const cache = new Map<string, CachedSongs>();
    const artistUserIdCache = new Map<ArtistId, number>();

    async function fetchJson<T>(url: string): Promise<T> {
        const response = await fetch(url, {
            headers: {
                Accept: "application/json",
            },
            cache: "no-store",
        });

        if (!response.ok) {
            throw new Error(`SoundCloud request failed (${response.status})`);
        }

        return (await response.json()) as T;
    }

    async function resolveArtistUserId(artist: ArtistId): Promise<number> {
        const cached = artistUserIdCache.get(artist);

        if (cached) {
            return cached;
        }

        const permalink = getSoundCloudPermalink(artist);
        const profileUrl = `https://soundcloud.com/${permalink}`;
        const resolveUrl = new URL("https://api-v2.soundcloud.com/resolve");
        resolveUrl.searchParams.set("url", profileUrl);
        resolveUrl.searchParams.set("client_id", options.clientId);

        const resolved = await fetchJson<SoundCloudResolveResponse>(resolveUrl.toString());

        if (!resolved?.id) {
            throw new Error(`Could not resolve SoundCloud artist ${artist}`);
        }

        artistUserIdCache.set(artist, resolved.id);
        return resolved.id;
    }

    async function fetchArtistTracks(artist: ArtistId): Promise<Song[]> {
        const userId = await resolveArtistUserId(artist);
        const firstPage = new URL(`https://api-v2.soundcloud.com/users/${userId}/tracks`);
        firstPage.searchParams.set("client_id", options.clientId);
        firstPage.searchParams.set("limit", "200");
        firstPage.searchParams.set("linked_partitioning", "1");

        const trackMap = new Map<string, Song>();
        let nextUrl: string | undefined = firstPage.toString();

        while (nextUrl) {
            const page: SoundCloudTracksResponse = await fetchJson<SoundCloudTracksResponse>(
                withClientId(nextUrl, options.clientId)
            );

            for (const track of page.collection ?? []) {
                const mapped = parseSoundCloudTrackToSong(track, artist);

                if (mapped) {
                    trackMap.set(mapped.id, mapped);
                }
            }

            nextUrl = page.next_href;
        }

        return sortSongsByTitle([...trackMap.values()]);
    }

    function normalizeArtists(artists: ArtistId[]): ArtistId[] {
        return artists.length > 0 ? artists : ARTIST_OPTIONS.map((option) => option.id);
    }

    async function getSongs(artists: ArtistId[] = []): Promise<Song[]> {
        const selectedArtists = normalizeArtists(artists);
        const cacheKey = makeArtistSelectionKey(selectedArtists);
        const now = Date.now();
        const cached = cache.get(cacheKey);

        if (cached && cached.expiresAt > now) {
            return cached.songs;
        }

        const artistSongs = await Promise.all(selectedArtists.map((artist) => fetchArtistTracks(artist)));
        const songs = sortSongsByTitle(artistSongs.flat());

        cache.set(cacheKey, {
            songs,
            expiresAt: now + SOUNDCLOUD_CACHE_TTL_MS,
        });

        return songs;
    }

    function fallbackCatalogEntries(artists: ArtistId[]): CatalogEntry[] {
        return getCatalogEntries(artists).sort((left, right) => {
            const byTitle = left.title.localeCompare(right.title);
            return byTitle !== 0 ? byTitle : left.artistLabel.localeCompare(right.artistLabel);
        });
    }

    return {
        id: "soundcloud",
        getSongById: async (songId) => {
            try {
                const songs = await getSongs();
                return songs.find((song) => song.id === songId);
            } catch {
                return getSongById(songId);
            }
        },
        isCorrectGuess: (song, guess) => isCorrectGuess(song, guess),
        getCatalogTitles: async (artists = []) => {
            try {
                const songs = await getSongs(artists);
                return songs.map((song) => song.title).sort((left, right) => left.localeCompare(right));
            } catch {
                return getCatalogTitles(artists);
            }
        },
        getCatalogEntries: async (artists = []) => {
            try {
                const songs = await getSongs(artists);
                return songs
                    .map((song) => ({
                        title: song.title,
                        artistId: song.artist,
                        artistLabel: ARTIST_LABEL_BY_ID.get(song.artist) ?? song.artist,
                    }))
                    .sort((left, right) => {
                        const byTitle = left.title.localeCompare(right.title);
                        return byTitle !== 0 ? byTitle : left.artistLabel.localeCompare(right.artistLabel);
                    });
            } catch {
                return fallbackCatalogEntries(artists);
            }
        },
        pickRandomSong: async (excludeSongId, artists = []) => {
            try {
                const songs = await getSongs(artists);

                if (songs.length === 0) {
                    return pickRandomSong(excludeSongId, artists);
                }

                return pickRandomFromSongs(songs, excludeSongId);
            } catch {
                return pickRandomSong(excludeSongId, artists);
            }
        },
        pickDailySong: async (dateKey, artists = []) => {
            try {
                const songs = await getSongs(artists);

                if (songs.length === 0) {
                    return pickDailySong(dateKey, artists);
                }

                return pickDailyFromSongs(dateKey, songs, artists);
            } catch {
                return pickDailySong(dateKey, artists);
            }
        },
    };
}

function resolveProviderId(): "static" | "spotify" | "soundcloud" {
    const value = process.env.HEARDLE_SONG_PROVIDER;

    if (value === "spotify" || value === "soundcloud") {
        return value;
    }

    return "static";
}

let cachedProvider: SongProvider | null = null;

export function getSongProvider(): SongProvider {
    if (cachedProvider) {
        return cachedProvider;
    }

    const providerId = resolveProviderId();

    if (providerId === "spotify") {
        cachedProvider = createSpotifySongProvider();
        return cachedProvider;
    }

    if (providerId === "soundcloud") {
        const clientId = process.env.HEARDLE_SOUNDCLOUD_CLIENT_ID;

        if (clientId?.trim()) {
            cachedProvider = createSoundCloudSongProvider({
                clientId: clientId.trim(),
            });
            return cachedProvider;
        }

        cachedProvider = staticSongProvider;
        return cachedProvider;
    }

    cachedProvider = staticSongProvider;
    return cachedProvider;
}
