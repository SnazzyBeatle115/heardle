import { createHash } from "node:crypto";
import { Pool } from "pg";
import {
    ARTIST_OPTIONS,
    filterSongsByArtists,
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
const SOUNDCLOUD_ARTIST_CACHE_TTL_MS = Number.parseInt(
    process.env.HEARDLE_SOUNDCLOUD_ARTIST_CACHE_TTL_MS ?? "86400000",
    10
);
const SOUNDCLOUD_DEFAULT_PREVIEW_START_MS = 12000;
const SOUNDCLOUD_END_BUFFER_MS = 20000;
const SOUNDCLOUD_API_BASE = "https://api.soundcloud.com";

type SoundCloudResolveResponse = {
    id: number;
    urn?: string;
    permalink?: string;
    username?: string;
    full_name?: string;
};

type SoundCloudUser = {
    id: number;
    urn?: string;
    permalink?: string;
    username?: string;
    full_name?: string;
};

type SoundCloudUsersResponse = {
    collection: SoundCloudUser[];
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

type SharedSoundCloudTokenState = {
    token: SoundCloudToken | null;
    inFlight: Promise<SoundCloudToken> | null;
    cooldownUntil: number;
};

type PersistedSoundCloudTokenState = {
    token: SoundCloudToken | null;
    cooldownUntil: number;
};

type PersistedSoundCloudTokenRow = {
    access_token: string | null;
    expires_at: Date | null;
    cooldown_until: Date | null;
};

type PersistedSoundCloudArtistTracksRow = {
    tracks_json: unknown;
    fetched_at: Date | null;
    source_user_ref: string | null;
};

type SoundCloudTokenStoreMode = "memory" | "neon";

type NeonTokenStore = {
    pool: Pool;
    initPromise: Promise<void>;
};

export type SongProviderRuntimeStatus = {
    activeProvider: SongProviderId;
    rateLimited: boolean;
    rateLimitUntilIso: string | null;
    message: string | null;
};

type SoundCloudUserDebugEntry = {
    id: number;
    urn: string | null;
    permalink: string | null;
    username: string | null;
    fullName: string | null;
};

type SoundCloudTrackLookupDebugResponse = {
    endpoint: string;
    status: number;
    count: number | null;
    nextHref: string | null;
    sampleTitles: string[];
    errors: unknown;
    responseBody: unknown;
};

export type SoundCloudArtistLookupDebugInfo = {
    artistId: ArtistId;
    artistLabel: string;
    searchQuery: string;
    permalink: string;
    searchCandidates: SoundCloudUserDebugEntry[];
    searchBestMatch: SoundCloudUserDebugEntry | null;
    permalinkResolved: SoundCloudUserDebugEntry | null;
    selectedSource: "search" | "permalink" | "none";
    selectedUser: SoundCloudUserDebugEntry | null;
    trackUserRef: string | null;
    tracksEndpointPreview: string | null;
    trackLookupSelectedRef: SoundCloudTrackLookupDebugResponse | null;
    trackLookupById: SoundCloudTrackLookupDebugResponse | null;
    error: string | null;
};

const sharedSoundCloudTokenStates = new Map<string, SharedSoundCloudTokenState>();
let sharedNeonTokenStore: NeonTokenStore | null = null;
let sharedNeonTokenStoreInitError: string | null = null;

class SoundCloudTokenRequestError extends Error {
    status: number;
    retryAfterMs: number | null;

    constructor(status: number, retryAfterMs: number | null) {
        super(`SoundCloud token request failed (${status})`);
        this.name = "SoundCloudTokenRequestError";
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

function parseRetryAfterMs(headers: Headers): number | null {
    const retryAfter = headers.get("retry-after");

    if (!retryAfter) {
        return null;
    }

    const asSeconds = Number.parseInt(retryAfter, 10);

    if (!Number.isNaN(asSeconds) && asSeconds >= 0) {
        return asSeconds * 1000;
    }

    const asDate = Date.parse(retryAfter);

    if (!Number.isNaN(asDate)) {
        return Math.max(0, asDate - Date.now());
    }

    return null;
}

function getSharedSoundCloudTokenState(clientId: string): SharedSoundCloudTokenState {
    const existing = sharedSoundCloudTokenStates.get(clientId);

    if (existing) {
        return existing;
    }

    const state: SharedSoundCloudTokenState = {
        token: null,
        inFlight: null,
        cooldownUntil: 0,
    };

    sharedSoundCloudTokenStates.set(clientId, state);
    return state;
}

function resolveSoundCloudTokenStoreDatabaseUrl(): string | null {
    const candidates = [
        process.env.HEARDLE_TOKEN_STORE_DATABASE_URL,
        process.env.DATABASE_URL,
        process.env.POSTGRES_URL_NON_POOLING,
        process.env.POSTGRES_URL,
        process.env.NEON_DATABASE_URL,
    ];

    for (const candidate of candidates) {
        if (candidate?.trim()) {
            return candidate.trim();
        }
    }

    return null;
}

function getNeonTokenStore(): NeonTokenStore | null {
    const connectionString = resolveSoundCloudTokenStoreDatabaseUrl();

    if (!connectionString) {
        return null;
    }

    if (sharedNeonTokenStore) {
        return sharedNeonTokenStore;
    }

    const pool = new Pool({
        connectionString,
        max: 3,
        idleTimeoutMillis: 10_000,
    });

    const initPromise = pool
        .query(`
            CREATE TABLE IF NOT EXISTS heardle_soundcloud_tokens (
                client_id TEXT PRIMARY KEY,
                access_token TEXT,
                expires_at TIMESTAMPTZ,
                cooldown_until TIMESTAMPTZ,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `)
        .then(() =>
            pool.query(`
                CREATE TABLE IF NOT EXISTS heardle_soundcloud_artist_tracks (
                    artist_id TEXT PRIMARY KEY,
                    tracks_json JSONB NOT NULL,
                    source_user_ref TEXT,
                    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            `)
        )
        .then(() =>
            pool.query(`
                ALTER TABLE heardle_soundcloud_artist_tracks
                ADD COLUMN IF NOT EXISTS source_user_ref TEXT
            `)
        )
        .then(() => {
            sharedNeonTokenStoreInitError = null;
        })
        .catch((error) => {
            sharedNeonTokenStoreInitError = error instanceof Error ? error.message : "Neon token store init failed";
        });

    sharedNeonTokenStore = {
        pool,
        initPromise,
    };

    return sharedNeonTokenStore;
}

async function readPersistedSoundCloudTokenState(clientId: string): Promise<PersistedSoundCloudTokenState> {
    const neon = getNeonTokenStore();

    if (!neon) {
        return {
            token: null,
            cooldownUntil: 0,
        };
    }

    try {
        await neon.initPromise;

        if (sharedNeonTokenStoreInitError) {
            return {
                token: null,
                cooldownUntil: 0,
            };
        }

        const result = await neon.pool.query<PersistedSoundCloudTokenRow>(
            `
                SELECT access_token, expires_at, cooldown_until
                FROM heardle_soundcloud_tokens
                WHERE client_id = $1
            `,
            [clientId]
        );

        const row = result.rows[0];

        if (!row) {
            return {
                token: null,
                cooldownUntil: 0,
            };
        }

        return {
            token:
                row.access_token && row.expires_at
                    ? {
                        accessToken: row.access_token,
                        expiresAt: row.expires_at.getTime(),
                    }
                    : null,
            cooldownUntil: row.cooldown_until?.getTime() ?? 0,
        };
    } catch (error) {
        sharedNeonTokenStoreInitError = error instanceof Error ? error.message : "Neon token store read failed";
        return {
            token: null,
            cooldownUntil: 0,
        };
    }
}

async function persistSoundCloudTokenState(clientId: string, state: PersistedSoundCloudTokenState): Promise<void> {
    const neon = getNeonTokenStore();

    if (!neon) {
        return;
    }

    try {
        await neon.initPromise;

        if (sharedNeonTokenStoreInitError) {
            return;
        }

        await neon.pool.query(
            `
                INSERT INTO heardle_soundcloud_tokens (client_id, access_token, expires_at, cooldown_until, updated_at)
                VALUES ($1, $2, $3, $4, now())
                ON CONFLICT (client_id) DO UPDATE
                SET access_token = EXCLUDED.access_token,
                    expires_at = EXCLUDED.expires_at,
                    cooldown_until = EXCLUDED.cooldown_until,
                    updated_at = now()
            `,
            [
                clientId,
                state.token?.accessToken ?? null,
                state.token ? new Date(state.token.expiresAt) : null,
                state.cooldownUntil > 0 ? new Date(state.cooldownUntil) : null,
            ]
        );
    } catch (error) {
        sharedNeonTokenStoreInitError = error instanceof Error ? error.message : "Neon token store write failed";
    }
}

function parsePersistedSongs(raw: unknown, artist: ArtistId): Song[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .map((item) => {
            if (!item || typeof item !== "object") {
                return null;
            }

            const candidate = item as Partial<Song>;

            if (
                typeof candidate.id !== "string" ||
                typeof candidate.title !== "string" ||
                typeof candidate.soundcloudUrl !== "string" ||
                typeof candidate.previewStartMs !== "number"
            ) {
                return null;
            }

            return {
                id: candidate.id,
                artist,
                title: candidate.title,
                aliases: Array.isArray(candidate.aliases)
                    ? candidate.aliases.filter((alias): alias is string => typeof alias === "string")
                    : [candidate.title],
                soundcloudUrl: candidate.soundcloudUrl,
                previewStartMs: candidate.previewStartMs,
            } as Song;
        })
        .filter((value): value is Song => value !== null);
}

async function readPersistedArtistTracks(artist: ArtistId, expectedUserRef: string): Promise<Song[] | null> {
    const neon = getNeonTokenStore();

    if (!neon) {
        return null;
    }

    try {
        await neon.initPromise;

        if (sharedNeonTokenStoreInitError) {
            return null;
        }

        const result = await neon.pool.query<PersistedSoundCloudArtistTracksRow>(
            `
                SELECT tracks_json, fetched_at, source_user_ref
                FROM heardle_soundcloud_artist_tracks
                WHERE artist_id = $1
            `,
            [artist]
        );

        const row = result.rows[0];

        if (!row || !row.fetched_at) {
            return null;
        }

        if (row.source_user_ref !== expectedUserRef) {
            return null;
        }

        const ageMs = Date.now() - row.fetched_at.getTime();

        if (ageMs > SOUNDCLOUD_ARTIST_CACHE_TTL_MS) {
            return null;
        }

        const songs = parsePersistedSongs(row.tracks_json, artist);

        if (songs.length === 0) {
            return null;
        }

        return songs;
    } catch (error) {
        sharedNeonTokenStoreInitError = error instanceof Error ? error.message : "Neon artist cache read failed";
        return null;
    }
}

async function persistArtistTracks(artist: ArtistId, songs: Song[], sourceUserRef: string): Promise<void> {
    const neon = getNeonTokenStore();

    if (!neon) {
        return;
    }

    try {
        await neon.initPromise;

        if (sharedNeonTokenStoreInitError) {
            return;
        }

        await neon.pool.query(
            `
                INSERT INTO heardle_soundcloud_artist_tracks (artist_id, tracks_json, source_user_ref, fetched_at, updated_at)
                VALUES ($1, $2::jsonb, $3, now(), now())
                ON CONFLICT (artist_id) DO UPDATE
                SET tracks_json = EXCLUDED.tracks_json,
                    source_user_ref = EXCLUDED.source_user_ref,
                    fetched_at = now(),
                    updated_at = now()
            `,
            [artist, JSON.stringify(songs), sourceUserRef]
        );
    } catch (error) {
        sharedNeonTokenStoreInitError = error instanceof Error ? error.message : "Neon artist cache write failed";
    }
}

async function syncCooldownFromPersistence(clientId: string): Promise<number> {
    const state = getSharedSoundCloudTokenState(clientId);
    const persisted = await readPersistedSoundCloudTokenState(clientId);

    state.cooldownUntil = Math.max(state.cooldownUntil, persisted.cooldownUntil);

    if (persisted.token && (!state.token || state.token.expiresAt < persisted.token.expiresAt)) {
        state.token = persisted.token;
    }

    return state.cooldownUntil;
}

async function setSoundCloudCooldown(clientId: string, cooldownUntil: number): Promise<void> {
    const state = getSharedSoundCloudTokenState(clientId);
    state.cooldownUntil = Math.max(state.cooldownUntil, cooldownUntil);

    await persistSoundCloudTokenState(clientId, {
        token: state.token,
        cooldownUntil: state.cooldownUntil,
    });
}

function getSoundCloudTokenStoreInfo(): { mode: SoundCloudTokenStoreMode; error: string | null } {
    const hasDatabase = Boolean(resolveSoundCloudTokenStoreDatabaseUrl());

    if (!hasDatabase) {
        return {
            mode: "memory",
            error: null,
        };
    }

    return {
        mode: "neon",
        error: sharedNeonTokenStoreInitError,
    };
}

function getSoundCloudPermalink(artist: ArtistId): string {
    const envSuffix = artist.toUpperCase().replace(/-/g, "_");
    const override = process.env[`HEARDLE_SOUNDCLOUD_${envSuffix}_PERMALINK`];
    return override?.trim() || DEFAULT_SOUNDCLOUD_PERMALINKS[artist];
}

function normalizeForMatch(value: string | undefined): string {
    return (value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

function getArtistDisplayName(artist: ArtistId): string {
    return ARTIST_LABEL_BY_ID.get(artist) ?? artist;
}

function toUserDebugEntry(user: {
    id: number;
    urn?: string;
    permalink?: string;
    username?: string;
    full_name?: string;
}): SoundCloudUserDebugEntry {
    return {
        id: user.id,
        urn: user.urn ?? null,
        permalink: user.permalink ?? null,
        username: user.username ?? null,
        fullName: user.full_name ?? null,
    };
}

function pickBestUserMatch(artist: ArtistId, users: SoundCloudUser[]): SoundCloudUser | null {
    if (users.length === 0) {
        return null;
    }

    const target = normalizeForMatch(getArtistDisplayName(artist));

    const scored = users
        .map((user) => {
            const username = normalizeForMatch(user.username);
            const fullName = normalizeForMatch(user.full_name);
            const permalink = normalizeForMatch(user.permalink);
            const exact = username === target || fullName === target || permalink === target;
            const partial = username.includes(target) || fullName.includes(target) || permalink.includes(target);

            return {
                user,
                score: exact ? 2 : partial ? 1 : 0,
            };
        })
        .sort((left, right) => right.score - left.score);

    if (scored[0]?.score > 0) {
        return scored[0].user;
    }

    return users[0];
}

function choosePreferredDebugUser(
    searchBestMatch: SoundCloudUserDebugEntry | null,
    permalinkResolved: SoundCloudUserDebugEntry | null
): {
    selectedUser: SoundCloudUserDebugEntry | null;
    selectedSource: SoundCloudArtistLookupDebugInfo["selectedSource"];
} {
    if (permalinkResolved) {
        return {
            selectedUser: permalinkResolved,
            selectedSource: "permalink",
        };
    }

    if (searchBestMatch) {
        return {
            selectedUser: searchBestMatch,
            selectedSource: "search",
        };
    }

    return {
        selectedUser: null,
        selectedSource: "none",
    };
}

function buildSoundCloudTracksEndpoint(userRef: string): string {
    const endpoint = new URL(`${SOUNDCLOUD_API_BASE}/users/${encodeURIComponent(userRef)}/tracks`);
    endpoint.searchParams.set("limit", "200");
    endpoint.searchParams.set("linked_partitioning", "1");
    return endpoint.toString();
}

async function fetchSoundCloudRawResponse(
    clientId: string,
    clientSecret: string,
    url: string
): Promise<{ status: number; body: unknown }> {
    const call = async (accessToken: string) =>
        fetch(url, {
            headers: {
                Accept: "application/json",
                Authorization: `OAuth ${accessToken}`,
            },
            cache: "no-store",
        });

    let response = await call(await getSharedSoundCloudAccessToken(clientId, clientSecret));

    if (response.status === 401 || response.status === 403) {
        response = await call(await getSharedSoundCloudAccessToken(clientId, clientSecret, true));
    }

    if (response.status === 429) {
        const waitMs = parseRetryAfterMs(response.headers) ?? 15 * 60 * 1000;
        await setSoundCloudCooldown(clientId, Date.now() + waitMs);
    }

    const body = await response.json().catch(() => null);

    return {
        status: response.status,
        body,
    };
}

function summarizeTrackLookupDebugResponse(
    endpoint: string,
    status: number,
    body: unknown
): SoundCloudTrackLookupDebugResponse {
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const collection = Array.isArray(payload?.collection) ? payload.collection : [];
    const count = collection.length;

    const sampleTitles = collection.slice(0, 10).map((track) => {
        if (!track || typeof track !== "object") {
            return "<unknown>";
        }

        const title = (track as { title?: unknown }).title;
        return typeof title === "string" ? title : "<unknown>";
    });

    const responseBody = payload
        ? {
            ...payload,
            collectionTotal: count,
            collection: collection.slice(0, 10),
            collectionTruncated: count > 10,
        }
        : body;

    return {
        endpoint,
        status,
        count: payload ? count : null,
        nextHref: typeof payload?.next_href === "string" ? payload.next_href : null,
        sampleTitles,
        errors: payload?.errors ?? null,
        responseBody,
    };
}

async function fetchSoundCloudJson<T>(clientId: string, clientSecret: string, url: string): Promise<T> {
    const call = async (accessToken: string) =>
        fetch(url, {
            headers: {
                Accept: "application/json",
                Authorization: `OAuth ${accessToken}`,
            },
            cache: "no-store",
        });

    const handleRateLimit = async (response: Response): Promise<void> => {
        if (response.status !== 429) {
            return;
        }

        const waitMs = parseRetryAfterMs(response.headers) ?? 15 * 60 * 1000;
        const cooldownUntil = Date.now() + waitMs;
        await setSoundCloudCooldown(clientId, cooldownUntil);
        throw new Error(`SoundCloud API rate-limited until ${new Date(cooldownUntil).toISOString()}`);
    };

    let response = await call(await getSharedSoundCloudAccessToken(clientId, clientSecret));

    await handleRateLimit(response);

    if (response.status === 401 || response.status === 403) {
        response = await call(await getSharedSoundCloudAccessToken(clientId, clientSecret, true));
        await handleRateLimit(response);
    }

    if (!response.ok) {
        throw new Error(`SoundCloud request failed (${response.status})`);
    }

    return (await response.json()) as T;
}

export async function getSoundCloudArtistLookupDebugInfo(): Promise<SoundCloudArtistLookupDebugInfo[]> {
    const clientId = process.env.HEARDLE_SOUNDCLOUD_CLIENT_ID?.trim();
    const clientSecret = process.env.HEARDLE_SOUNDCLOUD_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
        return ARTIST_OPTIONS.map((option) => ({
            artistId: option.id,
            artistLabel: option.label,
            searchQuery: option.label,
            permalink: getSoundCloudPermalink(option.id),
            searchCandidates: [],
            searchBestMatch: null,
            permalinkResolved: null,
            selectedSource: "none",
            selectedUser: null,
            trackUserRef: null,
            tracksEndpointPreview: null,
            trackLookupSelectedRef: null,
            trackLookupById: null,
            error: "SoundCloud credentials are not configured",
        }));
    }

    const results: SoundCloudArtistLookupDebugInfo[] = [];

    for (const option of ARTIST_OPTIONS) {
        const artistId = option.id;
        const searchQuery = getArtistDisplayName(artistId);
        const permalink = getSoundCloudPermalink(artistId);

        try {
            const usersUrl = new URL(`${SOUNDCLOUD_API_BASE}/users`);
            usersUrl.searchParams.set("q", searchQuery);
            usersUrl.searchParams.set("limit", "25");
            usersUrl.searchParams.set("linked_partitioning", "1");

            const usersResponse = await fetchSoundCloudJson<SoundCloudUsersResponse>(
                clientId,
                clientSecret,
                usersUrl.toString()
            );

            const searchCandidates = (usersResponse.collection ?? []).map((user) => toUserDebugEntry(user));
            const bestSearchUser = pickBestUserMatch(artistId, usersResponse.collection ?? []);
            const searchBestMatch = bestSearchUser ? toUserDebugEntry(bestSearchUser) : null;

            const resolveUrl = new URL(`${SOUNDCLOUD_API_BASE}/resolve`);
            resolveUrl.searchParams.set("url", `https://soundcloud.com/${permalink}`);

            const resolved = await fetchSoundCloudJson<SoundCloudResolveResponse>(
                clientId,
                clientSecret,
                resolveUrl.toString()
            );

            const permalinkResolved = resolved?.id ? toUserDebugEntry(resolved) : null;
            const { selectedUser, selectedSource } = choosePreferredDebugUser(searchBestMatch, permalinkResolved);
            const trackUserRef = selectedUser ? selectedUser.urn ?? String(selectedUser.id) : null;
            const tracksEndpointPreview = trackUserRef ? buildSoundCloudTracksEndpoint(trackUserRef) : null;

            let trackLookupSelectedRef: SoundCloudTrackLookupDebugResponse | null = null;

            if (tracksEndpointPreview) {
                const selectedLookup = await fetchSoundCloudRawResponse(clientId, clientSecret, tracksEndpointPreview);
                trackLookupSelectedRef = summarizeTrackLookupDebugResponse(
                    tracksEndpointPreview,
                    selectedLookup.status,
                    selectedLookup.body
                );
            }

            const numericIdRef = permalinkResolved ? String(permalinkResolved.id) : selectedUser ? String(selectedUser.id) : null;
            const idTracksEndpoint = numericIdRef ? buildSoundCloudTracksEndpoint(numericIdRef) : null;

            let trackLookupById: SoundCloudTrackLookupDebugResponse | null = null;

            if (idTracksEndpoint) {
                if (trackLookupSelectedRef && idTracksEndpoint === tracksEndpointPreview) {
                    trackLookupById = trackLookupSelectedRef;
                } else {
                    const byIdLookup = await fetchSoundCloudRawResponse(clientId, clientSecret, idTracksEndpoint);
                    trackLookupById = summarizeTrackLookupDebugResponse(
                        idTracksEndpoint,
                        byIdLookup.status,
                        byIdLookup.body
                    );
                }
            }

            results.push({
                artistId,
                artistLabel: option.label,
                searchQuery,
                permalink,
                searchCandidates,
                searchBestMatch,
                permalinkResolved,
                selectedSource,
                selectedUser,
                trackUserRef,
                tracksEndpointPreview,
                trackLookupSelectedRef,
                trackLookupById,
                error: null,
            });
        } catch (error) {
            results.push({
                artistId,
                artistLabel: option.label,
                searchQuery,
                permalink,
                searchCandidates: [],
                searchBestMatch: null,
                permalinkResolved: null,
                selectedSource: "none",
                selectedUser: null,
                trackUserRef: null,
                tracksEndpointPreview: null,
                trackLookupSelectedRef: null,
                trackLookupById: null,
                error: error instanceof Error ? error.message : "Failed to inspect SoundCloud artist lookup",
            });
        }
    }

    return results;
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
        throw new SoundCloudTokenRequestError(response.status, parseRetryAfterMs(response.headers));
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

async function getSharedSoundCloudAccessToken(
    clientId: string,
    clientSecret: string,
    forceRefresh = false
): Promise<string> {
    const state = getSharedSoundCloudTokenState(clientId);
    const now = Date.now();

    if (!forceRefresh) {
        await syncCooldownFromPersistence(clientId);
    }

    if (state.cooldownUntil > now) {
        throw new Error(`SoundCloud token request is rate-limited until ${new Date(state.cooldownUntil).toISOString()}`);
    }

    if (!forceRefresh && state.token && state.token.expiresAt > now + 30_000) {
        return state.token.accessToken;
    }

    state.inFlight ??= fetchSoundCloudAccessToken(clientId, clientSecret)
        .then(async (token) => {
            state.token = token;
            state.cooldownUntil = 0;
            await persistSoundCloudTokenState(clientId, {
                token,
                cooldownUntil: 0,
            });
            return token;
        })
        .catch(async (error) => {
            state.token = null;

            if (error instanceof SoundCloudTokenRequestError && error.status === 429) {
                const waitMs = error.retryAfterMs ?? 15 * 60 * 1000;
                state.cooldownUntil = Date.now() + waitMs;
                await persistSoundCloudTokenState(clientId, {
                    token: null,
                    cooldownUntil: state.cooldownUntil,
                });
            }

            throw error;
        })
        .finally(() => {
            state.inFlight = null;
        });

    const token = await state.inFlight;
    return token.accessToken;
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

    async function fetchJson<T>(url: string): Promise<T> {
        return fetchSoundCloudJson<T>(options.clientId, options.clientSecret, url);
    }

    async function resolveArtistUserBySearch(artist: ArtistId): Promise<{ id: number; urn?: string } | null> {
        const usersUrl = new URL(`${SOUNDCLOUD_API_BASE}/users`);
        usersUrl.searchParams.set("q", getArtistDisplayName(artist));
        usersUrl.searchParams.set("limit", "25");
        usersUrl.searchParams.set("linked_partitioning", "1");

        const usersResponse = await fetchJson<SoundCloudUsersResponse>(usersUrl.toString());
        const bestUser = pickBestUserMatch(artist, usersResponse.collection ?? []);

        if (!bestUser?.id) {
            return null;
        }

        return {
            id: bestUser.id,
            urn: bestUser.urn,
        };
    }

    async function resolveArtistUserByPermalink(artist: ArtistId): Promise<{ id: number; urn?: string }> {
        const permalink = getSoundCloudPermalink(artist);
        const profileUrl = `https://soundcloud.com/${permalink}`;
        const resolveUrl = new URL(`${SOUNDCLOUD_API_BASE}/resolve`);
        resolveUrl.searchParams.set("url", profileUrl);

        const resolved = await fetchJson<SoundCloudResolveResponse>(resolveUrl.toString());

        if (!resolved?.id) {
            throw new Error(`Could not resolve SoundCloud artist ${artist}`);
        }

        return {
            id: resolved.id,
            urn: resolved.urn,
        };
    }

    async function resolveArtistUser(artist: ArtistId): Promise<{ id: number; urn?: string }> {
        try {
            const fromPermalink = await resolveArtistUserByPermalink(artist);
            artistUserRefCache.set(artist, fromPermalink);
            return { ...fromPermalink };
        } catch {
            const cached = artistUserRefCache.get(artist);

            if (cached) {
                return { ...cached };
            }
        }

        const fromSearch = await resolveArtistUserBySearch(artist);

        if (!fromSearch) {
            throw new Error(`Could not resolve SoundCloud artist ${artist}`);
        }

        artistUserRefCache.set(artist, fromSearch);
        return { ...fromSearch };
    }

    async function fetchTracksForResolvedUser(artist: ArtistId, user: { id: number; urn?: string }): Promise<Song[]> {
        const buildTracksUrl = (userRef: string): string => {
            const url = new URL(`${SOUNDCLOUD_API_BASE}/users/${encodeURIComponent(userRef)}/tracks`);
            url.searchParams.set("limit", "200");
            url.searchParams.set("linked_partitioning", "1");
            return url.toString();
        };

        const urnRef = user.urn ?? null;
        const idRef = String(user.id);

        const trackMap = new Map<string, Song>();
        let nextUrl: string | undefined = buildTracksUrl(urnRef ?? idRef);

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
            await collectTracksFrom(buildTracksUrl(urnRef ?? idRef));
        } catch {
            if (!urnRef) {
                throw new Error(`Could not fetch SoundCloud tracks for artist ${artist}`);
            }

            trackMap.clear();
            await collectTracksFrom(buildTracksUrl(idRef));
        }

        if (trackMap.size === 0 && urnRef) {
            trackMap.clear();
            await collectTracksFrom(buildTracksUrl(idRef));
        }

        return sortSongsByTitle([...trackMap.values()]);
    }

    async function fetchArtistTracks(artist: ArtistId): Promise<Song[]> {
        const user = await resolveArtistUser(artist);
        const userRef = user.urn ?? String(user.id);
        const persistedTracks = await readPersistedArtistTracks(artist, userRef);

        if (persistedTracks) {
            return persistedTracks;
        }

        const tracks = await fetchTracksForResolvedUser(artist, user);

        if (tracks.length > 0) {
            await persistArtistTracks(artist, tracks, userRef);
            return tracks;
        }

        try {
            const fallbackUser = await resolveArtistUserByPermalink(artist);

            if (fallbackUser.id !== user.id || fallbackUser.urn !== user.urn) {
                const fallbackTracks = await fetchTracksForResolvedUser(artist, fallbackUser);
                const fallbackUserRef = fallbackUser.urn ?? String(fallbackUser.id);

                if (fallbackTracks.length > 0) {
                    artistUserRefCache.set(artist, fallbackUser);
                    await persistArtistTracks(artist, fallbackTracks, fallbackUserRef);
                    return fallbackTracks;
                }
            }
        } catch {
        }

        const staticFallbackTracks = sortSongsByTitle(filterSongsByArtists([artist]));

        if (staticFallbackTracks.length > 0) {
            await persistArtistTracks(artist, staticFallbackTracks, userRef);
            return staticFallbackTracks;
        }

        return tracks;
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
        const clientSecret = process.env.HEARDLE_SOUNDCLOUD_CLIENT_SECRET?.trim() ?? "";
        const accessToken = await getSharedSoundCloudAccessToken(clientId, clientSecret);
        const conanPermalink = getSoundCloudPermalink("conan-gray");
        const resolveUrl = new URL(`${SOUNDCLOUD_API_BASE}/resolve`);
        resolveUrl.searchParams.set("url", `https://soundcloud.com/${conanPermalink}`);

        const response = await fetch(resolveUrl.toString(), {
            headers: {
                Accept: "application/json",
                Authorization: `OAuth ${accessToken}`,
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

export async function getSongProviderRuntimeStatus(): Promise<SongProviderRuntimeStatus> {
    const activeProvider = getSongProvider().id;

    if (activeProvider !== "soundcloud") {
        return {
            activeProvider,
            rateLimited: false,
            rateLimitUntilIso: null,
            message: null,
        };
    }

    const clientId = process.env.HEARDLE_SOUNDCLOUD_CLIENT_ID?.trim();

    if (!clientId) {
        return {
            activeProvider,
            rateLimited: false,
            rateLimitUntilIso: null,
            message: null,
        };
    }

    const cooldownUntil = await syncCooldownFromPersistence(clientId);

    if (cooldownUntil > Date.now()) {
        const untilIso = new Date(cooldownUntil).toISOString();
        return {
            activeProvider,
            rateLimited: true,
            rateLimitUntilIso: untilIso,
            message: `SoundCloud is rate-limited right now. Using cached/static data until ${untilIso}.`,
        };
    }

    return {
        activeProvider,
        rateLimited: false,
        rateLimitUntilIso: null,
        message: null,
    };
}

export type SongProviderDebugInfo = {
    requestedProvider: string;
    activeProvider: SongProviderId;
    soundcloudClientIdConfigured: boolean;
    soundcloudClientSecretConfigured: boolean;
    soundcloudTokenStore: SoundCloudTokenStoreMode;
    soundcloudTokenStoreError: string | null;
    soundcloudConnected: boolean | null;
    soundcloudError: string | null;
};

export type SongProviderCacheClearResult = {
    providerInstanceCleared: boolean;
    inMemoryTokenStateCleared: boolean;
    persistedArtistCacheCleared: boolean;
    persistedArtistRowsDeleted: number | null;
    persistedArtistCacheError: string | null;
};

export async function getSongProviderDebugInfo(): Promise<SongProviderDebugInfo> {
    const requestedProvider = process.env.HEARDLE_SONG_PROVIDER ?? "static";
    const activeProvider = getSongProvider().id;
    const tokenStoreInfo = getSoundCloudTokenStoreInfo();
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
            soundcloudTokenStore: tokenStoreInfo.mode,
            soundcloudTokenStoreError: tokenStoreInfo.error,
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
            soundcloudTokenStore: tokenStoreInfo.mode,
            soundcloudTokenStoreError: tokenStoreInfo.error,
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
        soundcloudTokenStore: tokenStoreInfo.mode,
        soundcloudTokenStoreError: tokenStoreInfo.error,
        soundcloudConnected: connectivity.connected,
        soundcloudError: connectivity.error,
    };
}

export async function clearSongProviderCaches(options?: {
    clearPersistedArtistCache?: boolean;
    clearTokenState?: boolean;
}): Promise<SongProviderCacheClearResult> {
    const clearPersistedArtistCache = options?.clearPersistedArtistCache ?? true;
    const clearTokenState = options?.clearTokenState ?? false;

    cachedProvider = null;

    if (clearTokenState) {
        sharedSoundCloudTokenStates.clear();
    }

    let persistedArtistCacheCleared = false;
    let persistedArtistRowsDeleted: number | null = null;
    let persistedArtistCacheError: string | null = null;

    if (clearPersistedArtistCache) {
        const neon = getNeonTokenStore();

        if (neon) {
            try {
                await neon.initPromise;

                if (sharedNeonTokenStoreInitError) {
                    persistedArtistCacheError = sharedNeonTokenStoreInitError;
                } else {
                    const result = await neon.pool.query(`DELETE FROM heardle_soundcloud_artist_tracks`);
                    persistedArtistCacheCleared = true;
                    persistedArtistRowsDeleted = result.rowCount ?? 0;
                }
            } catch (error) {
                persistedArtistCacheError = error instanceof Error ? error.message : "Failed to clear persisted artist cache";
            }
        }
    }

    return {
        providerInstanceCleared: true,
        inMemoryTokenStateCleared: clearTokenState,
        persistedArtistCacheCleared,
        persistedArtistRowsDeleted,
        persistedArtistCacheError,
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
