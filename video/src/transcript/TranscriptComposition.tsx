import React from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {buildTimeline, INTRO_FRAMES} from '../episode/timeline';
import {Episode} from '../episode/types';
import {chunkTokenStartIndex, tokenize} from '../tokenize';

const SPEAKER_COLOR: Record<'L' | 'R', string> = {
	L: '#f0a868',
	R: '#7fb3e8',
};

const SIDEBAR_WIDTH = 520;
const MAX_SIDEBAR_ROWS = 10;

// One dialogue line. Words brighten as the narration reaches them
// (uniform stagger across the clip's real duration), target phrases
// turn gold. Past lines stay on screen, dimmed, like a transcript.
const Line: React.FC<{
	text: string;
	phrases: string[];
	speaker: 'L' | 'R';
	name: string;
	localFrame: number;
	durationInFrames: number;
	isCurrent: boolean;
}> = ({text, phrases, speaker, name, localFrame, durationInFrames, isCurrent}) => {
	const tokens = tokenize(text, phrases);
	const stagger = durationInFrames / Math.max(tokens.length, 1);

	return (
		<div style={{marginBottom: isCurrent ? 0 : 34, opacity: isCurrent ? 1 : 0.28}}>
			<div
				style={{
					fontFamily: 'Helvetica, Arial, sans-serif',
					fontSize: isCurrent ? 22 : 18,
					fontWeight: 700,
					letterSpacing: 3,
					color: SPEAKER_COLOR[speaker],
					marginBottom: isCurrent ? 14 : 8,
				}}
			>
				{name}
			</div>
			<div
				style={{
					display: 'flex',
					flexWrap: 'wrap',
					fontFamily: 'Helvetica, Arial, sans-serif',
					fontSize: isCurrent ? 46 : 30,
					fontWeight: 600,
					lineHeight: 1.4,
				}}
			>
				{tokens.map((token, i) => {
					const reached = isCurrent ? localFrame >= i * stagger : true;
					const base = token.isTarget ? '#ffd166' : '#f5f5f0';
					return (
						<span
							key={i}
							style={{
								marginRight: '0.28em',
								color: reached ? base : '#f5f5f0',
								opacity: reached ? 1 : 0.22,
								transition: 'none',
							}}
						>
							{token.word}
						</span>
					);
				})}
			</div>
		</div>
	);
};

// Sidebar entries must appear exactly when the narration reaches the word,
// so they share the transcript's uniform per-word stagger rather than the
// spotlight timeline's clamped one.
function buildWordCues(ep: Episode, timeline: ReturnType<typeof buildTimeline>) {
	return ep.turns.flatMap((turn, i) => {
		const tokenCount = turn.text.split(' ').length;
		const stagger = timeline.turnFrames[i] / Math.max(tokenCount, 1);
		return turn.spots.map((spot) => {
			const idx = chunkTokenStartIndex(turn.text, spot.realized);
			return {
				...spot,
				appearFrame: timeline.turnStartFrames[i] + Math.max(idx, 0) * stagger,
			};
		});
	});
}

export const TranscriptComposition: React.FC<{ep: Episode}> = ({ep}) => {
	const frame = useCurrentFrame();
	const timeline = buildTimeline(ep);
	const cues = buildWordCues(ep, timeline);

	const currentTurnIndex = timeline.turnStartFrames.reduce(
		(acc, start, i) => (frame >= start ? i : acc),
		-1,
	);

	const visibleTurns = ep.turns
		.map((turn, i) => ({turn, i}))
		.filter(({i}) => i <= currentTurnIndex);

	const words = cues.filter((e) => frame >= e.appearFrame);
	const shown = words.slice(-MAX_SIDEBAR_ROWS);

	const introFade = interpolate(frame, [INTRO_FRAMES - 15, INTRO_FRAMES], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

	return (
		<AbsoluteFill style={{backgroundColor: '#0d1620'}}>
			{ep.turns.map((turn, i) => (
				<Sequence
					key={i}
					from={timeline.turnStartFrames[i]}
					durationInFrames={timeline.turnFrames[i]}
				>
					<Audio src={staticFile(`audio/${turn.audio}`)} />
				</Sequence>
			))}

			{frame < INTRO_FRAMES && (
				<AbsoluteFill
					style={{
						alignItems: 'center',
						justifyContent: 'center',
						flexDirection: 'column',
						opacity: 1 - introFade,
					}}
				>
					<div
						style={{
							fontFamily: 'Helvetica, Arial, sans-serif',
							fontSize: 56,
							fontWeight: 800,
							color: '#ffd166',
						}}
					>
						{ep.titleEn}
					</div>
					<div
						style={{
							fontFamily: 'Helvetica, Arial, sans-serif',
							fontSize: 30,
							color: '#8ba0b5',
							marginTop: 14,
						}}
					>
						{ep.titleZh}
					</div>
				</AbsoluteFill>
			)}

			<AbsoluteFill style={{flexDirection: 'row', opacity: introFade}}>
				{/* transcript column — newest line sits at the bottom, older ones
				    push upward and clip out of frame */}
				<div
					style={{
						flex: 1,
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'flex-end',
						padding: '90px 60px 110px 96px',
						overflow: 'hidden',
						WebkitMaskImage:
							'linear-gradient(to bottom, transparent 0%, black 18%, black 100%)',
					}}
				>
					{visibleTurns.map(({turn, i}) => (
						<Line
							key={i}
							text={turn.text}
							phrases={[...turn.spots.map((s) => s.realized), ...turn.highlights]}
							speaker={turn.speaker}
							name={turn.speaker === 'L' ? ep.leftName : ep.rightName}
							localFrame={frame - timeline.turnStartFrames[i]}
							durationInFrames={timeline.turnFrames[i]}
							isCurrent={i === currentTurnIndex}
						/>
					))}
				</div>

				{/* vocabulary column */}
				<div
					style={{
						width: SIDEBAR_WIDTH,
						borderLeft: '1px solid rgba(255,255,255,0.08)',
						padding: '90px 56px',
						display: 'flex',
						flexDirection: 'column',
					}}
				>
					<div
						style={{
							fontFamily: 'Helvetica, Arial, sans-serif',
							fontSize: 17,
							fontWeight: 700,
							letterSpacing: 3,
							color: '#5c7590',
							marginBottom: 30,
						}}
					>
						NEW WORDS · {words.length}
					</div>

					{shown.map((w) => {
						const age = frame - w.appearFrame;
						const fade = interpolate(age, [0, 12], [0, 1], {
							extrapolateLeft: 'clamp',
							extrapolateRight: 'clamp',
						});
						return (
							<div key={w.phrase} style={{marginBottom: 20, opacity: fade}}>
								<div
									style={{
										fontFamily: 'Helvetica, Arial, sans-serif',
										fontSize: 26,
										fontWeight: 700,
										color: '#ffd166',
									}}
								>
									{w.phrase}
								</div>
								<div
									style={{
										fontFamily: 'Helvetica, Arial, sans-serif',
										fontSize: 21,
										color: '#a8bccf',
										marginTop: 2,
									}}
								>
									{w.zh}
								</div>
							</div>
						);
					})}
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
