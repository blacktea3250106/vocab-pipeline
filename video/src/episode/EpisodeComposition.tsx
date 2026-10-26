import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {TitleCard} from '../TitleCard';
import {buildEpisodeScene} from './episodeScene';
import {EpisodeSpotlight} from './EpisodeSpotlight';
import {EpisodeStage} from './EpisodeStage';
import {buildTimeline, INTRO_FRAMES, OUTRO_FRAMES} from './timeline';
import {Episode} from './types';

export const EpisodeComposition: React.FC<{ep: Episode}> = ({ep}) => {
	const scene = buildEpisodeScene(ep);
	const timeline = buildTimeline(ep);
	const wordCount = ep.turns.reduce((a, t) => a + t.spots.length + t.highlights.length, 0);

	return (
		<AbsoluteFill style={{backgroundColor: '#000'}}>
			<Sequence from={0} durationInFrames={INTRO_FRAMES}>
				<TitleCard lines={[ep.titleEn, ep.titleZh, `${ep.location} · ${ep.time}`]} />
			</Sequence>

			{ep.turns.map((turn, i) => (
				<Sequence
					key={i}
					from={timeline.turnStartFrames[i]}
					durationInFrames={timeline.turnFrames[i]}
				>
					<EpisodeStage
						ep={ep}
						scene={scene}
						turn={turn}
						durationInFrames={timeline.turnFrames[i]}
					/>
				</Sequence>
			))}

			<Sequence from={timeline.totalFrames - OUTRO_FRAMES} durationInFrames={OUTRO_FRAMES}>
				<TitleCard lines={[`${wordCount} words collected`, 'Day 02 · Rules & Regulations']} />
			</Sequence>

			<Sequence from={0} durationInFrames={timeline.totalFrames}>
				<EpisodeSpotlight
					events={timeline.spotEvents}
					leftName={ep.leftName}
					rightName={ep.rightName}
				/>
			</Sequence>
		</AbsoluteFill>
	);
};
