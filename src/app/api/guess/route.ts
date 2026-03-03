import { NextResponse } from "next/server";
import { getUtcDateKey } from "@/lib/game";
import { getSongProvider } from "@/lib/song-provider";
import { verifyPuzzleToken } from "@/lib/token";

type GuessRequest = {
    token: string;
    guess: string;
    round: number;
};

export async function POST(request: Request) {
    const songProvider = getSongProvider();
    const body = (await request.json()) as GuessRequest;

    if (!body?.token || typeof body.round !== "number") {
        return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
    }

    const payload = verifyPuzzleToken(body.token);

    if (!payload) {
        return NextResponse.json({ error: "Invalid puzzle token." }, { status: 401 });
    }

    if (payload.mode === "daily" && payload.dateKey !== getUtcDateKey()) {
        return NextResponse.json({ error: "Daily puzzle has expired. Start a new game." }, { status: 409 });
    }

    const song = await songProvider.getSongById(payload.songId);

    if (!song) {
        return NextResponse.json({ error: "Puzzle song not found." }, { status: 404 });
    }

    const correct = await songProvider.isCorrectGuess(song, body.guess ?? "");
    const lastRound = body.round >= 6;

    if (correct) {
        return NextResponse.json({
            correct: true,
            finished: true,
            answerTitle: song.title,
        });
    }

    return NextResponse.json({
        correct: false,
        finished: lastRound,
        answerTitle: lastRound ? song.title : null,
    });
}
