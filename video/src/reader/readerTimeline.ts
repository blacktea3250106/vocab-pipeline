import {chunkTokenStartIndex} from '../tokenize';
import {Episode, Spot} from '../episode/types';

export const FPS = 30;
export const TITLE_FRAMES = 60;
export const TAIL_FRAMES = 75;

// The project's mandated listening speed. Narration is generated at whatever
// rate edge-tts produces, so every clip is played back scaled to hit this.
export const TARGET_WPM = 155;

export type WordCue = Spot & {appearFrame: number};

export type ReaderTimeline = {
	rate: number;
	turnFrames: number[];
	turnStarts: number[];
	totalFrames: number;
	cues: WordCue[];
};

export function baseWpm(ep: Episode): number {
	const words = ep.turns.reduce((a, t) => a + t.text.split(' ').length, 0);
	const secs = ep.turns.reduce((a, t) => a + t.durationSec, 0);
	return words / (secs / 60);
}

export function buildReaderTimeline(ep: Episode, rate: number): ReaderTimeline {
	// playbackRate shortens each clip, so frames must be scaled to match
	const turnFrames = ep.turns.map((t) => Math.round((t.durationSec / rate) * FPS));

	let cursor = TITLE_FRAMES;
	const turnStarts = turnFrames.map((f) => {
		const start = cursor;
		cursor += f;
		return start;
	});

	const cues: WordCue[] = ep.turns.flatMap((turn, i) => {
		const tokenCount = turn.text.split(' ').length;
		const perToken = turnFrames[i] / Math.max(tokenCount, 1);
		return turn.spots.map((spot) => {
			const idx = chunkTokenStartIndex(turn.text, spot.realized);
			return {...spot, appearFrame: turnStarts[i] + Math.max(idx, 0) * perToken};
		});
	});

	return {rate, turnFrames, turnStarts, totalFrames: cursor + TAIL_FRAMES, cues};
}
