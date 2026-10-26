import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

export const TitleCard: React.FC<{lines: string[]}> = ({lines}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const enter = spring({frame, fps, config: {damping: 200}, durationInFrames: 20});

	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				background: 'linear-gradient(135deg, #101820, #1c2b36)',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			{lines.map((line, i) => (
				<div
					key={i}
					style={{
						fontFamily: 'Helvetica, Arial, sans-serif',
						fontSize: i === 0 ? 64 : 30,
						fontWeight: i === 0 ? 800 : 500,
						color: i === 0 ? '#ffd166' : '#cbd5e0',
						opacity: interpolate(enter, [0, 1], [0, 1]),
						transform: `translateY(${interpolate(enter, [0, 1], [20, 0])}px)`,
						marginTop: i === 0 ? 0 : 16,
					}}
				>
					{line}
				</div>
			))}
		</div>
	);
};
