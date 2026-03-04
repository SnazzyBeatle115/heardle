import { NextResponse } from "next/server";

import { getSongProviderRuntimeStatus } from "@/lib/song-provider";

export const dynamic = "force-dynamic";

export async function GET() {
    const status = await getSongProviderRuntimeStatus();

    return NextResponse.json(status, {
        headers: {
            "Cache-Control": "no-store",
        },
    });
}
