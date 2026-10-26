// Parameterized ASCII set builder for story episodes: two named character
// boxes, location header, story-state banner, and location-flavored props.

import {box, createCanvas, render, stamp} from '../asciiCanvas';
import {DOOR, PLANT, STATUS_BANNER, WINDOW} from '../props';
import {Episode} from './types';

const WIDTH = 54;
const HEIGHT = 13;

function headerIcon(location: string): string {
	const l = location.toLowerCase();
	if (l.includes('factory')) return '🏭';
	if (l.includes('judicial') || l.includes('hall')) return '🏛️';
	if (l.includes('training')) return '📚';
	return '🏢';
}

export function buildEpisodeScene(ep: Episode) {
	const leftX = 10;
	const rightX = 34;
	const boxY = 7;
	const boxWidth = 8;

	const canvas = createCanvas(WIDTH, HEIGHT);

	stamp(canvas, box(WIDTH, HEIGHT), 0, 0);
	stamp(canvas, [`${headerIcon(ep.location)} ${ep.location}`], 3, 1);
	stamp(canvas, [`🕐 ${ep.time}`], WIDTH - ep.time.length - 6, 1);
	stamp(canvas, ['├' + '─'.repeat(WIDTH - 2) + '┤'], 0, 2);

	stamp(canvas, WINDOW, 3, 4);
	stamp(canvas, PLANT, 46, 5);
	stamp(canvas, DOOR, 46, 8);

	stamp(canvas, box(boxWidth, 3, ep.leftName), leftX, boxY);
	stamp(canvas, box(boxWidth, 3, ep.rightName), rightX, boxY);

	stamp(canvas, [ep.leftIcon], leftX + 3, boxY - 1);
	stamp(canvas, [ep.rightIcon], rightX + 3, boxY - 1);
	stamp(canvas, ['══════'], leftX + 1, boxY + 3);
	stamp(canvas, ['══════'], rightX + 1, boxY + 3);

	const banner = STATUS_BANNER(ep.statusFrom, ep.statusTo)[0];
	stamp(canvas, [banner], Math.max(1, Math.floor((WIDTH - banner.length) / 2)), 11);

	return {
		text: render(canvas),
		charRow: boxY,
		leftCol: leftX,
		rightCol: rightX,
		boxWidth,
		gridWidth: WIDTH,
	};
}
