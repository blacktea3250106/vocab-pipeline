// A tiny "canvas" for composing ASCII scenes out of reusable prop blocks.
// Build once, reuse for every scene — stamping props onto a grid is much
// faster than hand-typing a full scene string with manual space-padding.

export type Canvas = string[][];

export function createCanvas(width: number, height: number): Canvas {
	return Array.from({length: height}, () => Array.from({length: width}, () => ' '));
}

// Writes a multi-line block onto the canvas at (x, y). Cells outside the
// canvas bounds are silently dropped. Uses Array.from so simple (single
// code-point) emoji are treated as one cell — good enough for decorative
// props that don't need pixel-perfect alignment.
export function stamp(canvas: Canvas, block: string[], x: number, y: number) {
	block.forEach((line, row) => {
		const chars = Array.from(line);
		chars.forEach((ch, col) => {
			const cy = y + row;
			const cx = x + col;
			if (cy >= 0 && cy < canvas.length && cx >= 0 && cx < canvas[0].length) {
				canvas[cy][cx] = ch;
			}
		});
	});
}

export function render(canvas: Canvas): string {
	return canvas.map((row) => row.join('')).join('\n');
}

export function box(width: number, height: number, label?: string): string[] {
	const top = '┌' + '─'.repeat(width - 2) + '┐';
	const bottom = '└' + '─'.repeat(width - 2) + '┘';
	const middleRows = Array.from({length: height - 2}, () => '│' + ' '.repeat(width - 2) + '│');
	if (label) {
		const mid = Math.floor(middleRows.length / 2);
		const pad = width - 2 - label.length;
		const left = Math.floor(pad / 2);
		const right = pad - left;
		middleRows[mid] = '│' + ' '.repeat(Math.max(left, 0)) + label + ' '.repeat(Math.max(right, 0)) + '│';
	}
	return [top, ...middleRows, bottom];
}
