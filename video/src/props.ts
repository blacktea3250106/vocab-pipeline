// Small reusable ASCII/emoji prop blocks. Keep these decorative props
// separate from the tracked character boxes (scene.ts) — props don't
// need pixel-perfect alignment, so emoji width drift here is harmless.

export const DESK = ['▭▭▭▭▭▭', '══════'];

export const LAPTOP = ['💻'];

export const CLIPBOARD = ['📋 résumé'];

export const CLOCK = (time: string) => [`🕐 ${time}`];

export const WINDOW = ['┌╌╌╌╌╌┐', '╎ 🪟  ╎', '└╌╌╌╌╌┘'];

export const DOOR = ['┌──┐', '│  │', '│ ●│', '└──┘'];

export const PLANT = ['🌿', '┃┃'];

export const NAMEPLATE = (text: string) => [`▁${text}▁`];

export const STATUS_BANNER = (from: string, to: string) => [`"${from}" ────► "${to}"`];

export const COFFEE = ['☕'];
