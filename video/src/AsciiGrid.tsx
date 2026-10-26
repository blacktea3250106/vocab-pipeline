import React from 'react';

// Renders ASCII/emoji scene text as a true fixed-size grid instead of a
// plain <pre>. Monospace fonts don't guarantee emoji are exactly 1 column
// wide, which breaks box-drawing borders whenever a wide glyph shares a
// row with them. Forcing every glyph into an identical cell (with
// overflow hidden) makes the grid perfectly rectangular regardless of
// glyph width, and gives pixel-exact coordinates for the highlight marker.

export const CELL_WIDTH = 13;
export const CELL_HEIGHT = 28;
const FONT_SIZE = 20;

export const AsciiGrid: React.FC<{text: string; color?: string}> = ({
	text,
	color = '#c9d6e3',
}) => {
	const rows = text.split('\n');

	return (
		<div style={{fontFamily: '"SF Mono", Menlo, Consolas, monospace'}}>
			{rows.map((row, y) => (
				<div key={y} style={{display: 'flex', height: CELL_HEIGHT}}>
					{Array.from(row).map((ch, x) => (
						<span
							key={x}
							style={{
								width: CELL_WIDTH,
								height: CELL_HEIGHT,
								flexShrink: 0,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								overflow: 'hidden',
								fontSize: FONT_SIZE,
								lineHeight: `${CELL_HEIGHT}px`,
								color,
							}}
						>
							{ch}
						</span>
					))}
				</div>
			))}
		</div>
	);
};
