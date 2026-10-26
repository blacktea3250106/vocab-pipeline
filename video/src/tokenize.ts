export type Token = {word: string; isTarget: boolean};

const clean = (w: string) => w.toLowerCase().replace(/[.,!?;:'’"]/g, '');

export function tokenize(text: string, chunks: string[]): Token[] {
	const words = text.split(' ');
	const normalized = words.map(clean);
	const isTarget = new Array(words.length).fill(false);

	for (const chunk of chunks) {
		const chunkWords = chunk.split(' ').map(clean);
		for (let i = 0; i <= normalized.length - chunkWords.length; i++) {
			let match = true;
			for (let j = 0; j < chunkWords.length; j++) {
				if (normalized[i + j] !== chunkWords[j]) {
					match = false;
					break;
				}
			}
			if (match) {
				for (let j = 0; j < chunkWords.length; j++) {
					isTarget[i + j] = true;
				}
			}
		}
	}

	return words.map((word, i) => ({word, isTarget: isTarget[i]}));
}

export function staggerPerWord(durationInFrames: number, tokenCount: number): number {
	return Math.min(4, Math.floor((durationInFrames * 0.5) / tokenCount));
}

export function firstTargetStartFrame(tokens: Token[], durationInFrames: number): number {
	const stagger = staggerPerWord(durationInFrames, tokens.length);
	const idx = tokens.findIndex((t) => t.isTarget);
	return idx === -1 ? 0 : idx * stagger;
}

export function chunkTokenStartIndex(text: string, phrase: string): number {
	const words = text.split(' ').map(clean);
	const phraseWords = phrase.split(' ').map(clean);
	for (let i = 0; i <= words.length - phraseWords.length; i++) {
		let match = true;
		for (let j = 0; j < phraseWords.length; j++) {
			if (words[i + j] !== phraseWords[j]) {
				match = false;
				break;
			}
		}
		if (match) return i;
	}
	return -1;
}
