import { ARTIST_OPTIONS, type ArtistId } from "@/lib/songs";
import { getSongProvider, getSongProviderDebugInfo } from "@/lib/song-provider";

export const dynamic = "force-dynamic";

export default async function DebugPage() {
    const songProvider = getSongProvider();
    const debugInfo = await getSongProviderDebugInfo();
    let soundCloudConnectedLabel = "N/A";

    if (debugInfo.soundcloudConnected === true) {
        soundCloudConnectedLabel = "Yes";
    } else if (debugInfo.soundcloudConnected === false) {
        soundCloudConnectedLabel = "No";
    }

    const selectedArtists: ArtistId[] = ARTIST_OPTIONS.map((option) => option.id);
    const entries = await songProvider.getCatalogEntries(selectedArtists);

    const grouped = entries.reduce<Record<string, string[]>>((accumulator, entry) => {
        if (!accumulator[entry.artistLabel]) {
            accumulator[entry.artistLabel] = [];
        }

        accumulator[entry.artistLabel].push(entry.title);
        return accumulator;
    }, {});

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
                        SoundCloud connected: <span className="font-semibold">{soundCloudConnectedLabel}</span>
                    </p>
                    {debugInfo.soundcloudError ? (
                        <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            {debugInfo.soundcloudError}
                        </p>
                    ) : null}
                </div>
            </section>

            <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/20 dark:bg-black/30">
                <h2 className="text-lg font-semibold">Available Songs ({entries.length})</h2>
                <div className="mt-4 space-y-4">
                    {artistSections.map(([artistLabel, titles]) => (
                        <div key={artistLabel} className="rounded-lg border border-black/10 p-3 dark:border-white/20">
                            <p className="text-sm font-semibold">{artistLabel} ({titles.length})</p>
                            <ul className="mt-2 grid gap-1 text-sm text-black/80 dark:text-white/80">
                                {titles.map((title, index) => (
                                    <li key={`${artistLabel}-${title}-${index}`}>{title}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </section>
        </main>
    );
}
