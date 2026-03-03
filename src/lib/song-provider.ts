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

export type SongProviderId = "static" | "spotify" | "soundcloud";

export type SongProvider = {
    id: SongProviderId;
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
const SOUNDCLOUD_API_BASE = "https://api.soundcloud.com";

type SoundCloudResolveResponse = {
    id: number;
    urn?: string;
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
    clientSecret: string;
};

type SoundCloudTokenResponse = {
    access_token?: string;
    expires_in?: number;
};

type SoundCloudToken = {
    accessToken: string;
    expiresAt: number;
};

function getSoundCloudPermalink(artist: ArtistId): string {
    const envSuffix = artist.toUpperCase().replace(/-/g, "_");
    const override = process.env[`HEARDLE_SOUNDCLOUD_${envSuffix}_PERMALINK`];
    return override?.trim() || DEFAULT_SOUNDCLOUD_PERMALINKS[artist];
}

async function fetchSoundCloudAccessToken(clientId: string, clientSecret: string): Promise<SoundCloudToken> {
    const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
    const response = await fetch("https://secure.soundcloud.com/oauth/token", {
        method: "POST",
        headers: {
            Accept: "application/json; charset=utf-8",
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({
            grant_type: "client_credentials",
        }),
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(`SoundCloud token request failed (${response.status})`);
    }

    const payload = (await response.json()) as SoundCloudTokenResponse;

    if (!payload.access_token) {
        throw new Error("SoundCloud token response missing access_token");
    }

    const expiresInSeconds = payload.expires_in && payload.expires_in > 0 ? payload.expires_in : 3600;
    return {
        accessToken: payload.access_token,
        expiresAt: Date.now() + expiresInSeconds * 1000,
    };
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
    const artistUserRefCache = new Map<ArtistId, { id: number; urn?: string }>();
    let token: SoundCloudToken | null = null;

    async function getAccessToken(forceRefresh = false): Promise<string> {
        if (!forceRefresh && token && token.expiresAt > Date.now() + 30_000) {
            return token.accessToken;
        }

        token = await fetchSoundCloudAccessToken(options.clientId, options.clientSecret);
        return token.accessToken;
    }

    async function fetchJson<T>(url: string): Promise<T> {
        const call = async (accessToken: string) =>
            fetch(url, {
                headers: {
                    Accept: "application/json",
                    Authorization: `OAuth ${accessToken}`,
                },
                cache: "no-store",
            });

        let response = await call(await getAccessToken());

        if (response.status === 401 || response.status === 403) {
            response = await call(await getAccessToken(true));
        }

        if (!response.ok) {
            throw new Error(`SoundCloud request failed (${response.status})`);
        }

        return (await response.json()) as T;
    }

    async function resolveArtistUser(artist: ArtistId): Promise<{ id: number; urn?: string }> {
        const cached = artistUserRefCache.get(artist);

        if (cached) {
            return { ...cached };
        }

        const permalink = getSoundCloudPermalink(artist);
        const profileUrl = `https://soundcloud.com/${permalink}`;
        const resolveUrl = new URL(`${SOUNDCLOUD_API_BASE}/resolve`);
        resolveUrl.searchParams.set("url", profileUrl);

        const resolved = await fetchJson<SoundCloudResolveResponse>(resolveUrl.toString());

        if (!resolved?.id) {
            throw new Error(`Could not resolve SoundCloud artist ${artist}`);
        }

        const user = {
            id: resolved.id,
            urn: resolved.urn,
        };

        artistUserRefCache.set(artist, user);
        return user;
    }

    async function fetchArtistTracks(artist: ArtistId): Promise<Song[]> {
        const user = await resolveArtistUser(artist);
        const encodedUserRef = encodeURIComponent(user.urn ?? String(user.id));
        const firstPage = new URL(`${SOUNDCLOUD_API_BASE}/users/${encodedUserRef}/tracks`);
        firstPage.searchParams.set("limit", "200");
        firstPage.searchParams.set("linked_partitioning", "1");

        const trackMap = new Map<string, Song>();
        let nextUrl: string | undefined = firstPage.toString();

        async function collectTracksFrom(startUrl: string): Promise<void> {
            nextUrl = startUrl;

            while (nextUrl) {
                const page: SoundCloudTracksResponse = await fetchJson<SoundCloudTracksResponse>(nextUrl);

                for (const track of page.collection ?? []) {
                    const mapped = parseSoundCloudTrackToSong(track, artist);

                    if (mapped) {
                        trackMap.set(mapped.id, mapped);
                    }
                }

                nextUrl = page.next_href;
            }
        }

        try {
            await collectTracksFrom(firstPage.toString());
        } catch {
            if (!user.urn) {
                throw new Error(`Could not fetch SoundCloud tracks for artist ${artist}`);
            }

            const fallbackUrl = new URL(`${SOUNDCLOUD_API_BASE}/users/${user.id}/tracks`);
            fallbackUrl.searchParams.set("limit", "200");
            fallbackUrl.searchParams.set("linked_partitioning", "1");
            trackMap.clear();
            await collectTracksFrom(fallbackUrl.toString());
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

type SoundCloudConnectivity = {
    connected: boolean;
    error: string | null;
};

async function checkSoundCloudConnectivity(clientId: string): Promise<SoundCloudConnectivity> {
    try {
        const token = await fetchSoundCloudAccessToken(clientId, process.env.HEARDLE_SOUNDCLOUD_CLIENT_SECRET?.trim() ?? "");
        const conanPermalink = getSoundCloudPermalink("conan-gray");
        const resolveUrl = new URL(`${SOUNDCLOUD_API_BASE}/resolve`);
        resolveUrl.searchParams.set("url", `https://soundcloud.com/${conanPermalink}`);

        const response = await fetch(resolveUrl.toString(), {
            headers: {
                Accept: "application/json",
                Authorization: `OAuth ${token.accessToken}`,
            },
            cache: "no-store",
        });

        if (!response.ok) {
            return {
                connected: false,
                error: `SoundCloud API status ${response.status}`,
            };
        }

        const payload = (await response.json()) as { id?: number };

        if (!payload?.id) {
            return {
                connected: false,
                error: "SoundCloud resolve returned no user id",
            };
        }

        return {
            connected: true,
            error: null,
        };
    } catch (error) {
        return {
            connected: false,
            error: error instanceof Error ? error.message : "Unknown SoundCloud connectivity error",
        };
    }
}

export type SongProviderDebugInfo = {
    requestedProvider: string;
    activeProvider: SongProviderId;
    soundcloudClientIdConfigured: boolean;
    soundcloudClientSecretConfigured: boolean;
    soundcloudConnected: boolean | null;
    soundcloudError: string | null;
};

export async function getSongProviderDebugInfo(): Promise<SongProviderDebugInfo> {
    const requestedProvider = process.env.HEARDLE_SONG_PROVIDER ?? "static";
    const activeProvider = getSongProvider().id;
    const clientId = process.env.HEARDLE_SOUNDCLOUD_CLIENT_ID?.trim();
    const clientSecret = process.env.HEARDLE_SOUNDCLOUD_CLIENT_SECRET?.trim();
    const soundcloudClientIdConfigured = Boolean(clientId);
    const soundcloudClientSecretConfigured = Boolean(clientSecret);

    if (requestedProvider !== "soundcloud") {
        return {
            requestedProvider,
            activeProvider,
            soundcloudClientIdConfigured,
            soundcloudClientSecretConfigured,
            soundcloudConnected: null,
            soundcloudError: null,
        };
    }

    if (!clientId || !clientSecret) {
        return {
            requestedProvider,
            activeProvider,
            soundcloudClientIdConfigured,
            soundcloudClientSecretConfigured,
            soundcloudConnected: false,
            soundcloudError: "HEARDLE_SOUNDCLOUD_CLIENT_ID or HEARDLE_SOUNDCLOUD_CLIENT_SECRET is missing",
        };
    }

    const connectivity = await checkSoundCloudConnectivity(clientId);
    return {
        requestedProvider,
        activeProvider,
        soundcloudClientIdConfigured,
        soundcloudClientSecretConfigured,
        soundcloudConnected: connectivity.connected,
        soundcloudError: connectivity.error,
    };
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
        const clientSecret = process.env.HEARDLE_SOUNDCLOUD_CLIENT_SECRET;

        if (clientId?.trim() && clientSecret?.trim()) {
            cachedProvider = createSoundCloudSongProvider({
                clientId: clientId.trim(),
                clientSecret: clientSecret.trim(),
            });
            return cachedProvider;
        }

        cachedProvider = staticSongProvider;
        return cachedProvider;
    }

    cachedProvider = staticSongProvider;
    return cachedProvider;
}
