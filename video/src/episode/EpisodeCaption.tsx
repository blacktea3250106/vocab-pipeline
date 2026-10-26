import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {staggerPerWord, tokenize} from '../tokenize';
import {EpTurn} from './types';

const SPEAKER_COLOR: Record<'L' | 'R', string> = {
	L: '#f0a868',
	R: '#7fb3e8',
};

export const EpisodeCaption: React.FC<{
	turn: EpTurn;
	durationInFrames: number;
	leftName: string;
	rightName: string;
}> = ({turn, durationInFrames, leftName, rightName}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();

	const phrases = [...turn.spots.map((s) => s.realized), ...turn.highlights];
	const tokens = tokenize(turn.text, phrases);
	const stagger = staggerPerWord(durationInFrames, tokens.length);

	const name = turn.speaker === 'L' ? leftName : rightName;

	return (
		<div style={{padding: '0 120px'}}>
			<div
				style={{
					fontFamily: 'Helvetica, Arial, sans-serif',
					fontSize: 24,
					fontWeight: 700,
					letterSpacing: 3,
					color: SPEAKER_COLOR[turn.speaker],
					textTransform: 'uppercase',
					marginBottom: 18,
				}}
			>
				{name}
			</div>

			<div
				style={{
					display: 'flex',
					flexWrap: 'wrap',
					fontFamily: 'Helvetica, Arial, sans-serif',
					fontSize: 40,
					fontWeight: 600,
					lineHeight: 1.3,
					color: '#f5f5f0',
				}}
			>
				{tokens.map((token, i) => {
					const startFrame = i * stagger;
					const wordProgress = spring({
						frame: frame - startFrame,
						fps,
						config: {damping: 200},
						durationInFrames: 12,
					});
					const opacity = interpolate(wordProgress, [0, 1], [0, 1]);
					const translateY = interpolate(wordProgress, [0, 1], [18, 0]);

					const targetPop = token.isTarget
						? spring({
								frame: frame - startFrame - 6,
								fps,
								config: {damping: 12, stiffness: 180},
								durationInFrames: 20,
							})
						: 0;
					const scale = token.isTarget ? interpolate(targetPop, [0, 1], [1, 1.08]) : 1;

					return (
						<span
							key={i}
							style={{
								opacity,
								transform: `translateY(${translateY}px) scale(${scale})`,
								marginRight: token.isTarget ? 20 : 14,
								color: token.isTarget ? '#ffd166' : '#f5f5f0',
								textShadow: token.isTarget ? '0 0 20px rgba(255,209,102,0.5)' : 'none',
							}}
						>
							{token.word}
						</span>
					);
				})}
			</div>

			{turn.spots.length > 0 && (
				<div
					style={{
						marginTop: 24,
						display: 'flex',
						gap: 14,
						flexWrap: 'wrap',
						opacity: interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], {
							extrapolateLeft: 'clamp',
						}),
					}}
				>
					{turn.spots.map((spot) => (
						<div
							key={spot.phrase}
							style={{
								fontFamily: 'Helvetica, Arial, sans-serif',
								fontSize: 18,
								fontWeight: 600,
								color: '#0f2942',
								background: '#ffd166',
								padding: '6px 16px',
								borderRadius: 999,
							}}
						>
							{spot.icon} {spot.phrase} · {spot.zh}
						</div>
					))}
				</div>
			)}
		</div>
	);
};
