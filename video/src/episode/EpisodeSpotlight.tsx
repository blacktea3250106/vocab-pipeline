import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {SpotEvent} from './types';

const TIER_LABEL: Record<string, string> = {
	chunk: 'CORE',
	score_800: '800',
	score_900: '900',
};

const SpotlightCard: React.FC<{event: SpotEvent; frame: number}> = ({event, frame}) => {
	const {fps} = useVideoConfig();
	const local = frame - event.startFrame;
	const cardFrames = event.endFrame - event.startFrame;

	const enter = spring({frame: local, fps, config: {damping: 16, stiffness: 160}, durationInFrames: 10});
	const exit = interpolate(local, [cardFrames - 8, cardFrames], [1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const scale = interpolate(enter, [0, 1], [0.8, 1]) * (0.88 + 0.12 * exit);
	const opacity = interpolate(enter, [0, 1], [0, 1]) * exit;

	const hasDiagram = Boolean(event.diagram);

	return (
		<div
			style={{
				position: 'absolute',
				inset: 0,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				background: `rgba(5, 10, 18, ${0.74 * opacity})`,
			}}
		>
			<div
				style={{
					transform: `scale(${scale})`,
					opacity,
					background: '#101b28',
					border: '2px solid #ffd166',
					borderRadius: 20,
					padding: hasDiagram ? '40px 56px' : '44px 72px',
					maxWidth: 1500,
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					boxShadow: '0 0 80px rgba(255,209,102,0.25)',
				}}
			>
				<div
					style={{
						fontFamily: 'Helvetica, Arial, sans-serif',
						fontSize: 15,
						fontWeight: 700,
						letterSpacing: 3,
						color: '#5c7590',
						marginBottom: 6,
					}}
				>
					{TIER_LABEL[event.tier] ?? event.tier}
				</div>
				<div
					style={{
						fontFamily: 'Helvetica, Arial, sans-serif',
						fontSize: 54,
						fontWeight: 800,
						color: '#ffd166',
						textAlign: 'center',
					}}
				>
					{event.phrase}
				</div>
				<div
					style={{
						fontFamily: 'Helvetica, Arial, sans-serif',
						fontSize: 30,
						fontWeight: 600,
						color: '#e8edf2',
						marginTop: 8,
						marginBottom: hasDiagram ? 24 : 18,
					}}
				>
					{event.zh}
				</div>

				{event.diagram ? (
					<>
						<pre
							style={{
								fontFamily: '"SF Mono", Menlo, Consolas, monospace',
								fontSize: 21,
								lineHeight: 1.5,
								color: '#c9d6e3',
								margin: 0,
							}}
						>
							{event.diagram.ascii}
						</pre>
						<div
							style={{
								fontFamily: 'Helvetica, Arial, sans-serif',
								fontSize: 22,
								color: '#ffd166',
								marginTop: 18,
							}}
						>
							{event.diagram.mnemonic}
						</div>
					</>
				) : (
					<>
						<div style={{fontSize: 120, lineHeight: 1.15}}>{event.icon}</div>
						{event.exampleZh && (
							<div
								style={{
									fontFamily: 'Helvetica, Arial, sans-serif',
									fontSize: 22,
									color: '#8ba0b5',
									marginTop: 20,
									textAlign: 'center',
								}}
							>
								{event.exampleZh}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
};

const MAX_TRAY_ICONS = 24;

const Tray: React.FC<{side: 'L' | 'R'; name: string; landed: SpotEvent[]}> = ({
	side,
	name,
	landed,
}) => (
	<div
		style={{
			position: 'absolute',
			top: 36,
			[side === 'L' ? 'left' : 'right']: 44,
			display: 'flex',
			flexDirection: 'column',
			alignItems: side === 'L' ? 'flex-start' : 'flex-end',
		} as React.CSSProperties}
	>
		<div
			style={{
				fontFamily: 'Helvetica, Arial, sans-serif',
				fontSize: 16,
				fontWeight: 700,
				letterSpacing: 2,
				color: '#5c7590',
				marginBottom: 8,
			}}
		>
			{name} · {landed.length}
		</div>
		<div
			style={{
				display: 'flex',
				gap: 6,
				flexWrap: 'wrap',
				maxWidth: 300,
				justifyContent: side === 'L' ? 'flex-start' : 'flex-end',
			}}
		>
			{landed.slice(-MAX_TRAY_ICONS).map((e, i) => (
				<div
					key={i}
					style={{
						fontSize: 20,
						background: 'rgba(255,209,102,0.12)',
						border: '1px solid rgba(255,209,102,0.35)',
						borderRadius: 7,
						width: 33,
						height: 33,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					{e.icon}
				</div>
			))}
		</div>
	</div>
);

export const EpisodeSpotlight: React.FC<{
	events: SpotEvent[];
	leftName: string;
	rightName: string;
}> = ({events, leftName, rightName}) => {
	const frame = useCurrentFrame();

	const active = events.find((e) => frame >= e.startFrame && frame < e.endFrame);
	const landed = events.filter((e) => frame >= e.endFrame);

	return (
		<div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
			<Tray side="L" name={leftName} landed={landed.filter((e) => e.speaker === 'L')} />
			<Tray side="R" name={rightName} landed={landed.filter((e) => e.speaker === 'R')} />
			{active && <SpotlightCard event={active} frame={frame} />}
		</div>
	);
};
