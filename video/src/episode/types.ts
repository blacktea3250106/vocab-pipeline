export type Spot = {
	phrase: string;
	realized: string;
	zh: string;
	icon: string;
	tier: string;
	diagram?: {ascii: string; mnemonic: string};
	exampleZh?: string;
};

export type EpTurn = {
	speaker: 'L' | 'R';
	voice: string;
	text: string;
	audio: string;
	spots: Spot[];
	highlights: string[];
	durationSec: number;
};

export type Episode = {
	id: string;
	titleEn: string;
	titleZh: string;
	location: string;
	time: string;
	statusFrom: string;
	statusTo: string;
	leftName: string;
	rightName: string;
	leftIcon: string;
	rightIcon: string;
	turns: EpTurn[];
};

export type SpotEvent = Spot & {
	turnIndex: number;
	speaker: 'L' | 'R';
	startFrame: number;
	endFrame: number;
};
