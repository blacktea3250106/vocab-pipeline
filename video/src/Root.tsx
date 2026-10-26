import React from 'react';
import {Composition} from 'remotion';
import day01Json from './day01/episodes.json';
import {EpisodeComposition} from './episode/EpisodeComposition';
import {buildTimeline, FPS as EP_FPS} from './episode/timeline';
import {Episode} from './episode/types';
import {ReaderComposition} from './reader/ReaderComposition';
import {baseWpm, buildReaderTimeline, FPS as READER_FPS, TARGET_WPM} from './reader/readerTimeline';
import {TranscriptComposition} from './transcript/TranscriptComposition';

// Each finished day gets one entry: video/tools/build_story.py writes
// src/dayNN/episodes.json and the narration clips under public/audio/dayNN/.
// The repo ships the synthetic sample day only.
const DAYS: {day: string; episodes: Episode[]}[] = [
	{day: '01', episodes: day01Json as Episode[]},
];

const SIZE = {width: 1920, height: 1080};

export const RemotionRoot: React.FC = () => {
	return (
		<>
			{DAYS.flatMap(({day, episodes}) =>
				episodes.flatMap((ep) => [
					// ASCII stage: two characters, captions, vocabulary spotlight cards
					<Composition
						key={`s${day}-${ep.id}`}
						id={`Day${day}-Stage-${ep.id}`}
						component={EpisodeComposition}
						durationInFrames={buildTimeline(ep).totalFrames}
						fps={EP_FPS}
						{...SIZE}
						defaultProps={{ep}}
					/>,
					// Scrolling transcript with chunk highlighting
					<Composition
						key={`t${day}-${ep.id}`}
						id={`Day${day}-Transcript-${ep.id}`}
						component={TranscriptComposition}
						durationInFrames={buildTimeline(ep).totalFrames}
						fps={EP_FPS}
						{...SIZE}
						defaultProps={{ep}}
					/>,
					// Speed reader locked to the target listening rate
					<Composition
						key={`r${day}-${ep.id}`}
						id={`Day${day}-Reader-${ep.id}`}
						component={ReaderComposition}
						durationInFrames={buildReaderTimeline(ep, TARGET_WPM / baseWpm(ep)).totalFrames}
						fps={READER_FPS}
						{...SIZE}
						defaultProps={{ep}}
					/>,
				]),
			)}
		</>
	);
};
