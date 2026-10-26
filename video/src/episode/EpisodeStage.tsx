import React from 'react';
import {Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {AsciiGrid, CELL_HEIGHT, CELL_WIDTH} from '../AsciiGrid';
import {EpisodeCaption} from './EpisodeCaption';
import {buildEpisodeScene} from './episodeScene';
import {Episode, EpTurn} from './types';

export const EpisodeStage: React.FC<{
	ep: Episode;
	scene: ReturnType<typeof buildEpisodeScene>;
	turn: EpTurn;
	durationInFrames: number;
}> = ({ep, scene, turn, durationInFrames}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();

	const activeCol = turn.speaker === 'L' ? scene.leftCol : scene.rightCol;

	const pulse = spring({frame, fps, config: {damping: 200}, durationInFrames: 15});
	const glow = 0.5 + 0.5 * Math.sin(frame / 8);

	const gridPixelWidth = scene.gridWidth * CELL_WIDTH;
	const speakerCenterX = activeCol * CELL_WIDTH + (scene.boxWidth * CELL_WIDTH) / 2;
	const panTarget = -(speakerCenterX - gridPixelWidth / 2) * 0.12;
	const camEase = spring({frame, fps, config: {damping: 200}, durationInFrames: 40});
	const pan = interpolate(camEase, [0, 1], [0, panTarget]);
	const zoom = interpolate(camEase, [0, 1], [1, 1.035]);

	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				background: 'linear-gradient(180deg, #0b1420 0%, #131f2e 100%)',
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'center',
				overflow: 'hidden',
			}}
		>
			<Audio src={staticFile(`audio/${turn.audio}`)} />

			<div
				style={{
					position: 'relative',
					alignSelf: 'center',
					marginBottom: 56,
					transform: `translateX(${pan}px) scale(${zoom})`,
				}}
			>
				<AsciiGrid text={scene.text} />

				<div
					style={{
						position: 'absolute',
						left: activeCol * CELL_WIDTH,
						top: scene.charRow * CELL_HEIGHT,
						width: scene.boxWidth * CELL_WIDTH,
						height: 3 * CELL_HEIGHT,
						border: `2px solid rgba(255, 209, 102, ${0.6 + 0.4 * glow})`,
						borderRadius: 6,
						boxShadow: `0 0 ${12 + 10 * glow}px rgba(255, 209, 102, ${0.5 * glow})`,
						opacity: interpolate(pulse, [0, 1], [0, 1]),
						pointerEvents: 'none',
					}}
				/>
			</div>

			<EpisodeCaption
				turn={turn}
				durationInFrames={durationInFrames}
				leftName={ep.leftName}
				rightName={ep.rightName}
			/>
		</div>
	);
};
