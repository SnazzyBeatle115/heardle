import { ARTIST_OPTIONS, type ArtistId } from "@/lib/songs";
import { getSongProvider, getSongProviderDebugInfo, getSoundCloudArtistLookupDebugInfo } from "@/lib/song-provider";

export const dynamic = "force-dynamic";

export default async function DebugPage() {
    const songProvider = getSongProvider();
    const debugInfo = await getSongProviderDebugInfo();
    const lookupInfo = await getSoundCloudArtistLookupDebugInfo();
    let soundCloudConnectedLabel = "N/A";

    if (debugInfo.soundcloudConnected === true) {
        soundCloudConnectedLabel = "Yes";
    } else if (debugInfo.soundcloudConnected === false) {
        soundCloudConnectedLabel = "No";
    }

    const selectedArtists: ArtistId[] = ARTIST_OPTIONS.map((option) => option.id);
    const entries = await songProvider.getCatalogEntries(selectedArtists);

    const grouped = entries.reduce<Record<string, string[]>>(
        (accumulator, entry) => {
            accumulator[entry.artistLabel].push(entry.title);
            return accumulator;
        },
        ARTIST_OPTIONS.reduce<Record<string, string[]>>((accumulator, option) => {
            accumulator[option.label] = [];
            return accumulator;
        }, {})
    );

    const artistSections = Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right));

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">Heardle Debug</h1>
                <p className="text-sm text-black/70 dark:text-white/70">Provider status and available song catalog.</p>
            </header>

            <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/20 dark:bg-black/30">
                <h2 className="text-lg font-semibold">Provider Status</h2>
                <div className="mt-3 grid gap-2 text-sm">
                    <p>
                        Requested provider: <span className="font-semibold">{debugInfo.requestedProvider}</span>
                    </p>
                    <p>
                        Active provider: <span className="font-semibold">{debugInfo.activeProvider}</span>
                    </p>
                    <p>
                        SoundCloud client ID configured: <span className="font-semibold">{debugInfo.soundcloudClientIdConfigured ? "Yes" : "No"}</span>
                    </p>
                    <p>
                        SoundCloud client secret configured: <span className="font-semibold">{debugInfo.soundcloudClientSecretConfigured ? "Yes" : "No"}</span>
                    </p>
                    <p>
                        SoundCloud token store: <span className="font-semibold">{debugInfo.soundcloudTokenStore}</span>
                    </p>
                    {debugInfo.soundcloudTokenStoreError ? (
                        <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            Token store warning: {debugInfo.soundcloudTokenStoreError}
                        </p>
                    ) : null}
                    <p>
                        SoundCloud connected: <span className="font-semibold">{soundCloudConnectedLabel}</span>
                    </p>
                    {debugInfo.soundcloudError ? (
                        <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            {debugInfo.soundcloudError}
                        </p>
                    ) : null}
                    <div className="pt-2">
                        <a
                            href="/api/admin/clear-cache?run=1&redirect=1"
                            className="inline-flex items-center rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/30 dark:hover:bg-white/10"
                        >
                            Clear provider cache now (dev/admin)
                        </a>
                    </div>
                </div>
            </section>

            <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/20 dark:bg-black/30">
                <h2 className="text-lg font-semibold">Available Songs ({entries.length})</h2>
                <div className="mt-4 space-y-4">
                    {artistSections.map(([artistLabel, titles]) => (
                        <div key={artistLabel} className="rounded-lg border border-black/10 p-3 dark:border-white/20">
                            <p className="text-sm font-semibold">{artistLabel} ({titles.length})</p>
                            {titles.length > 0 ? (
                                <ul className="mt-2 grid gap-1 text-sm text-black/80 dark:text-white/80">
                                    {titles.map((title, index) => (
                                        <li key={`${artistLabel}-${title}-${index}`}>{title}</li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="mt-2 text-sm text-black/60 dark:text-white/60">No songs resolved for this artist.</p>
                            )}
                        </div>
                    ))}
                </div>
            </section>

            <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/20 dark:bg-black/30">
                <h2 className="text-lg font-semibold">SoundCloud Artist User Lookup</h2>
                <p className="mt-1 text-sm text-black/70 dark:text-white/70">
                    Shows the user accounts queried for each artist and the account currently selected for the tracks endpoint.
                </p>
                <div className="mt-4 space-y-4">
                    {lookupInfo.map((artistInfo) => (
                        <div key={artistInfo.artistId} className="rounded-lg border border-black/10 p-3 dark:border-white/20">
                            <p className="text-sm font-semibold">{artistInfo.artistLabel}</p>
                            <div className="mt-2 grid gap-1 text-sm">
                                <p>Search query: <span className="font-mono">{artistInfo.searchQuery}</span></p>
                                <p>Permalink fallback: <span className="font-mono">{artistInfo.permalink}</span></p>
                                <p>Selected source: <span className="font-semibold">{artistInfo.selectedSource}</span></p>
                                <p>Track user ref: <span className="font-mono">{artistInfo.trackUserRef ?? "N/A"}</span></p>
                                <p className="break-all">Tracks endpoint: <span className="font-mono">{artistInfo.tracksEndpointPreview ?? "N/A"}</span></p>
                            </div>

                            {artistInfo.error ? (
                                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                                    {artistInfo.error}
                                </p>
                            ) : null}

                            <div className="mt-3 grid gap-2 text-sm">
                                <p className="font-semibold">Best search match</p>
                                {artistInfo.searchBestMatch ? (
                                    <p className="break-all text-black/80 dark:text-white/80">
                                        id={artistInfo.searchBestMatch.id}, username={artistInfo.searchBestMatch.username ?? "N/A"},
                                        fullName={artistInfo.searchBestMatch.fullName ?? "N/A"}, permalink={artistInfo.searchBestMatch.permalink ?? "N/A"},
                                        urn={artistInfo.searchBestMatch.urn ?? "N/A"}
                                    </p>
                                ) : (
                                    <p className="text-black/60 dark:text-white/60">No search match selected.</p>
                                )}

                                <p className="font-semibold">Permalink resolve result</p>
                                {artistInfo.permalinkResolved ? (
                                    <p className="break-all text-black/80 dark:text-white/80">
                                        id={artistInfo.permalinkResolved.id}, username={artistInfo.permalinkResolved.username ?? "N/A"},
                                        fullName={artistInfo.permalinkResolved.fullName ?? "N/A"}, permalink={artistInfo.permalinkResolved.permalink ?? "N/A"},
                                        urn={artistInfo.permalinkResolved.urn ?? "N/A"}
                                    </p>
                                ) : (
                                    <p className="text-black/60 dark:text-white/60">No permalink-resolved user.</p>
                                )}
                            </div>

                            <div className="mt-3">
                                <p className="text-sm font-semibold">Search candidates ({artistInfo.searchCandidates.length})</p>
                                {artistInfo.searchCandidates.length > 0 ? (
                                    <ul className="mt-2 grid gap-1 text-sm text-black/80 dark:text-white/80">
                                        {artistInfo.searchCandidates.slice(0, 10).map((candidate) => (
                                            <li key={`${artistInfo.artistId}-${candidate.id}`} className="break-all">
                                                id={candidate.id}, username={candidate.username ?? "N/A"}, fullName={candidate.fullName ?? "N/A"}, permalink={candidate.permalink ?? "N/A"}, urn={candidate.urn ?? "N/A"}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="mt-2 text-sm text-black/60 dark:text-white/60">No user candidates returned.</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </main>
    );
}
