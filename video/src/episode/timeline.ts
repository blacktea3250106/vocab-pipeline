import {chunkTokenStartIndex, staggerPerWord} from '../tokenize';
import {Episode, SpotEvent} from './types';

export const FPS = 30;
export const INTRO_FRAMES = 75;
export const OUTRO_FRAMES = 90;

export const toFrames = (sec: number) => Math.round(sec * FPS);

export type Timeline = {
	turnFrames: number[];
	turnStartFrames: number[];
	totalFrames: number;
	spotEvents: SpotEvent[];
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function buildTimeline(ep: Episode): Timeline {
	const turnFrames = ep.turns.map((t) => toFrames(t.durationSec));

	let cursor = INTRO_FRAMES;
	const turnStartFrames = turnFrames.map((f) => {
		const start = cursor;
		cursor += f;
		return start;
	});
	const totalFrames = cursor + OUTRO_FRAMES;

	const spotEvents: SpotEvent[] = ep.turns.flatMap((turn, turnIndex) => {
		if (turn.spots.length === 0) return [];
		const words = turn.text.split(' ');
		const stagger = staggerPerWord(turnFrames[turnIndex], words.length);
		// adaptive card duration so N cards always fit inside their own turn
		const cardFrames = clamp(
			Math.floor((turnFrames[turnIndex] * 0.85) / turn.spots.length),
			16,
			34,
		);
		let earliestNextStart = 0;

		return turn.spots.map((spot) => {
			const idx = chunkTokenStartIndex(turn.text, spot.realized);
			const naturalStart = idx === -1 ? 0 : idx * stagger;
			const localStart = Math.max(naturalStart, earliestNextStart);
			earliestNextStart = localStart + cardFrames;

			const startFrame = turnStartFrames[turnIndex] + localStart;
			return {
				...spot,
				turnIndex,
				speaker: turn.speaker,
				startFrame,
				endFrame: startFrame + cardFrames,
			};
		});
	});

	return {turnFrames, turnStartFrames, totalFrames, spotEvents};
}
