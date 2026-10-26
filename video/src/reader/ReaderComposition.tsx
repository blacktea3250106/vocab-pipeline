import React from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {Episode, EpTurn} from '../episode/types';
import {tokenize} from '../tokenize';
import {
	baseWpm,
	buildReaderTimeline,
	FPS,
	TARGET_WPM,
	TITLE_FRAMES,
	WordCue,
} from './readerTimeline';

// Mirrors output/dayNN/story.html: one whole line at a time (no karaoke
// reveal, no surrounding context) with the vocabulary column filling up
// beside it. Same palette, same layout, just rendered to video.

const SPEAKER_COLOR: Record<'L' | 'R', string> = {L: '#f0a868', R: '#7fb3e8'};
const SIDEBAR_WIDTH = 520;
const MAX_ROWS = 10;

const Line: React.FC<{turn: EpTurn; name: string; localFrame: number}> = ({
	turn,
	name,
	localFrame,
}) => {
	const phrases = turn.spots.map((s) => s.realized);
	const tokens = tokenize(turn.text, phrases);
	const fade = interpolate(localFrame, [0, 8], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const rise = interpolate(localFrame, [0, 12], [14, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

	return (
		<div style={{opacity: fade, transform: `translateY(${rise}px)`}}>
			<div
				style={{
					fontFamily: 'Helvetica, Arial, sans-serif',
					fontSize: 24,
					fontWeight: 700,
					letterSpacing: 3,
					color: SPEAKER_COLOR[turn.speaker],
					marginBottom: 26,
				}}
			>
				{name}
			</div>
			<div
				style={{
					display: 'flex',
					flexWrap: 'wrap',
					fontFamily: 'Helvetica, Arial, sans-serif',
					fontSize: 50,
					fontWeight: 650,
					lineHeight: 1.42,
					color: '#f2f5f8',
				}}
			>
				{tokens.map((t, i) => (
					<span
						key={i}
						style={{marginRight: '0.28em', color: t.isTarget ? '#ffd166' : '#f2f5f8'}}
					>
						{t.word}
					</span>
				))}
			</div>
		</div>
	);
};

const Sidebar: React.FC<{cues: WordCue[]; frame: number}> = ({cues, frame}) => {
	const seen = cues.filter((c) => frame >= c.appearFrame);
	const shown = seen.slice(-MAX_ROWS);

	return (
		<div
			style={{
				width: SIDEBAR_WIDTH,
				flex: 'none',
				borderLeft: '1px solid rgba(255,255,255,0.09)',
				background: '#101b26',
				padding: '78px 56px',
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
				NEW WORDS · {seen.length}
			</div>
			{shown.map((w) => (
				<div
					key={w.phrase}
					style={{
						marginBottom: 20,
						opacity: interpolate(frame - w.appearFrame, [0, 10], [0, 1], {
							extrapolateLeft: 'clamp',
							extrapolateRight: 'clamp',
						}),
					}}
				>
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
			))}
		</div>
	);
};

export const ReaderComposition: React.FC<{ep: Episode}> = ({ep}) => {
	const frame = useCurrentFrame();
	const rate = TARGET_WPM / baseWpm(ep);
	const tl = buildReaderTimeline(ep, rate);

	const current = tl.turnStarts.reduce((acc, s, i) => (frame >= s ? i : acc), -1);
	const introFade = interpolate(frame, [TITLE_FRAMES - 12, TITLE_FRAMES], [1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

	return (
		<AbsoluteFill style={{backgroundColor: '#0d1620'}}>
			{ep.turns.map((turn, i) => (
				<Sequence key={i} from={tl.turnStarts[i]} durationInFrames={tl.turnFrames[i]}>
					<Audio src={staticFile(`audio/${turn.audio}`)} playbackRate={rate} />
				</Sequence>
			))}

			<AbsoluteFill style={{flexDirection: 'row'}}>
				<div
					style={{
						flex: 1,
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'center',
						padding: '0 60px 0 96px',
						minWidth: 0,
					}}
				>
					{current >= 0 && (
						<Line
							turn={ep.turns[current]}
							name={ep.turns[current].speaker === 'L' ? ep.leftName : ep.rightName}
							localFrame={frame - tl.turnStarts[current]}
						/>
					)}
				</div>
				<Sidebar cues={tl.cues} frame={frame} />
			</AbsoluteFill>

			{frame < TITLE_FRAMES && (
				<AbsoluteFill
					style={{
						backgroundColor: '#0d1620',
						alignItems: 'center',
						justifyContent: 'center',
						flexDirection: 'column',
						opacity: introFade,
					}}
				>
					<div
						style={{
							fontFamily: 'Helvetica, Arial, sans-serif',
							fontSize: 58,
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
					<div
						style={{
							fontFamily: 'Helvetica, Arial, sans-serif',
							fontSize: 18,
							color: '#5c7590',
							marginTop: 26,
							letterSpacing: 2,
						}}
					>
						{TARGET_WPM} WPM
					</div>
				</AbsoluteFill>
			)}
		</AbsoluteFill>
	);
};
