"use client";

import Script from "next/script";
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";

type SoundCloudWidget = {
    bind: (event: string, callback: () => void) => void;
    getDuration: (callback: (durationMs: number) => void) => void;
    seekTo: (milliseconds: number) => void;
    play: () => void;
    pause: () => void;
};

declare global {
    interface Window {
        SC?: {
            Widget: {
                (iframe: HTMLIFrameElement): SoundCloudWidget;
                Events: {
                    READY: string;
                };
            };
        };
    }
}

export type SoundCloudPlayerHandle = {
    requestPlayback: () => boolean;
};

type Props = {
    soundcloudUrl: string;
    revealMetadata: boolean;
    clipStartMs: number;
    clipDurationMs: number;
    disabled?: boolean;
    onClipFinished: () => void;
};

const DEFAULT_THEME = "ff5500";
const END_BUFFER_MS = 1000;

export const SoundCloudPlayer = forwardRef<SoundCloudPlayerHandle, Props>(
    function SoundCloudPlayer(
        {
            soundcloudUrl,
            revealMetadata,
            clipStartMs,
            clipDurationMs,
            disabled: _disabled,
            onClipFinished,
        },
        ref,
    ) {
        const iframeRef = useRef<HTMLIFrameElement | null>(null);
        const widgetRef = useRef<SoundCloudWidget | null>(null);
        const timeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
        const pendingPlayRequestRef = useRef(false);
        const selectedStartMsRef = useRef<number | null>(null);
        const [scriptReady, setScriptReady] = useState(false);

        const embedSrc = useMemo(() => {
            const params = new URLSearchParams({
                url: soundcloudUrl,
                auto_play: "false",
                hide_related: "true",
                show_comments: "false",
                show_user: revealMetadata ? "true" : "false",
                show_reposts: "false",
                show_teaser: revealMetadata ? "true" : "false",
                visual: revealMetadata ? "true" : "false",
                color: DEFAULT_THEME,
            });

            return `https://w.soundcloud.com/player/?${params.toString()}`;
        }, [revealMetadata, soundcloudUrl]);

        const runClipPlayback = useCallback((widget: SoundCloudWidget) => {
            if (timeoutRef.current) {
                globalThis.clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }

            const startPlayback = (startMs: number) => {
                widget.seekTo(startMs);
                widget.play();

                timeoutRef.current = globalThis.setTimeout(() => {
                    widget.pause();
                    onClipFinished();
                }, clipDurationMs);
            };

            if (selectedStartMsRef.current !== null) {
                startPlayback(selectedStartMsRef.current);
                return;
            }

            try {
                widget.getDuration((durationMs) => {
                    const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
                    const latestStart = Math.max(0, safeDuration - clipDurationMs - END_BUFFER_MS);
                    const randomStart = latestStart > 0
                        ? Math.floor(Math.random() * (latestStart + 1))
                        : 0;

                    selectedStartMsRef.current = safeDuration > 0 ? randomStart : clipStartMs;
                    startPlayback(selectedStartMsRef.current);
                });
            } catch {
                selectedStartMsRef.current = clipStartMs;
                startPlayback(clipStartMs);
            }
        }, [clipDurationMs, clipStartMs, onClipFinished]);

        const requestPlayback = useCallback(() => {
            const widget = widgetRef.current;

            if (!widget) {
                pendingPlayRequestRef.current = true;
                return false;
            }

            runClipPlayback(widget);
            pendingPlayRequestRef.current = false;
            return true;
        }, [runClipPlayback]);

        useImperativeHandle(ref, () => ({ requestPlayback }), [requestPlayback]);

        useEffect(() => {
            widgetRef.current = null;
            pendingPlayRequestRef.current = false;
            selectedStartMsRef.current = null;

            if (timeoutRef.current) {
                globalThis.clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        }, [embedSrc]);

        useEffect(() => {
            if (!scriptReady || !iframeRef.current || !window.SC?.Widget) {
                return;
            }

            const widget = window.SC.Widget(iframeRef.current);
            widget.bind(window.SC.Widget.Events.READY, () => {
                widgetRef.current = widget;

                if (pendingPlayRequestRef.current) {
                    runClipPlayback(widget);
                    pendingPlayRequestRef.current = false;
                }
            });
        }, [embedSrc, runClipPlayback, scriptReady]);

        useEffect(() => {
            return () => {
                if (timeoutRef.current) {
                    globalThis.clearTimeout(timeoutRef.current);
                }
            };
        }, []);

        return (
            <>
                <Script
                    src="https://w.soundcloud.com/player/api.js"
                    strategy="afterInteractive"
                    onReady={() => setScriptReady(true)}
                />
                {!revealMetadata ? (
                    <div className="rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-sm text-black/70 dark:border-white/20 dark:bg-white/10 dark:text-white/70">
                        SoundCloud player details are hidden until the round is complete.
                    </div>
                ) : null}
                <iframe
                    ref={iframeRef}
                    title="Heardle SoundCloud clip"
                    width="100%"
                    height="160"
                    allow="autoplay"
                    src={embedSrc}
                    className={
                        revealMetadata
                            ? "w-full rounded-xl border border-black/10 bg-white"
                            : "absolute -left-[9999px] top-0 h-px w-px opacity-0 pointer-events-none"
                    }
                    aria-hidden={!revealMetadata}
                    tabIndex={revealMetadata ? 0 : -1}
                />
            </>
        );
    },
);
