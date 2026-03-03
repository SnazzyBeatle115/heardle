import { createHmac, timingSafeEqual } from "node:crypto";
import type { GameMode } from "./game";

export type PuzzleTokenPayload = {
    songId: string;
    mode: GameMode;
    dateKey?: string;
    issuedAt: number;
};

function getSecret(): string {
    return process.env.HEARDLE_TOKEN_SECRET ?? "heardle-dev-secret-change-me";
}

function base64UrlEncode(value: string): string {
    return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
    return Buffer.from(value, "base64url").toString("utf8");
}

export function signPuzzleToken(payload: PuzzleTokenPayload): string {
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");
    return `${encodedPayload}.${signature}`;
}

export function verifyPuzzleToken(token: string): PuzzleTokenPayload | null {
    const [encodedPayload, signature] = token.split(".");

    if (!encodedPayload || !signature) {
        return null;
    }

    const expectedSignature = createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");

    const providedBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (providedBuffer.length !== expectedBuffer.length) {
        return null;
    }

    if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
        return null;
    }

    try {
        const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as PuzzleTokenPayload;

        if (!parsed.songId || !parsed.mode || !parsed.issuedAt) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}
