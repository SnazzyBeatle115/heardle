import { NextResponse } from "next/server";

import { clearSongProviderCaches } from "@/lib/song-provider";

export const dynamic = "force-dynamic";

type ClearCacheRequestBody = {
    clearPersistedArtistCache?: boolean;
    clearTokenState?: boolean;
};

function isClearCacheEnabled(): boolean {
    if (process.env.NODE_ENV !== "production") {
        return true;
    }

    return process.env.HEARDLE_ENABLE_ADMIN_CACHE_CLEAR === "true";
}

function parseBooleanQueryParam(value: string | null): boolean | undefined {
    if (value === null) {
        return undefined;
    }

    if (value === "true" || value === "1") {
        return true;
    }

    if (value === "false" || value === "0") {
        return false;
    }

    return undefined;
}

async function executeClearCache(request: Request) {
    if (!isClearCacheEnabled()) {
        return NextResponse.json(
            {
                error: "Cache clear route is disabled in production unless HEARDLE_ENABLE_ADMIN_CACHE_CLEAR=true",
            },
            { status: 403 }
        );
    }

    let body: ClearCacheRequestBody = {};

    try {
        body = (await request.json()) as ClearCacheRequestBody;
    } catch {
    }

    const result = await clearSongProviderCaches({
        clearPersistedArtistCache: body.clearPersistedArtistCache ?? true,
        clearTokenState: body.clearTokenState ?? false,
    });

    return NextResponse.json({
        ok: true,
        environment: process.env.NODE_ENV ?? "development",
        ...result,
    });
}

export async function POST(request: Request) {
    return executeClearCache(request);
}

export async function GET(request: Request) {
    if (!isClearCacheEnabled()) {
        return NextResponse.json(
            {
                error: "Cache clear route is disabled in production unless HEARDLE_ENABLE_ADMIN_CACHE_CLEAR=true",
            },
            { status: 403 }
        );
    }

    const { searchParams } = new URL(request.url);
    const run = parseBooleanQueryParam(searchParams.get("run"));

    if (!run) {
        return NextResponse.json({
            ok: false,
            message: "Send POST /api/admin/clear-cache or open /api/admin/clear-cache?run=1 to clear caches.",
            enabled: true,
            environment: process.env.NODE_ENV ?? "development",
        });
    }

    const clearPersistedArtistCache = parseBooleanQueryParam(searchParams.get("clearPersistedArtistCache"));
    const clearTokenState = parseBooleanQueryParam(searchParams.get("clearTokenState"));

    const result = await clearSongProviderCaches({
        clearPersistedArtistCache: clearPersistedArtistCache ?? true,
        clearTokenState: clearTokenState ?? false,
    });

    const redirect = parseBooleanQueryParam(searchParams.get("redirect"));

    if (redirect) {
        const redirectUrl = new URL("/debug", request.url);
        redirectUrl.searchParams.set("cacheCleared", "1");
        return NextResponse.redirect(redirectUrl);
    }

    return NextResponse.json({
        ok: true,
        environment: process.env.NODE_ENV ?? "development",
        ...result,
    });
}
