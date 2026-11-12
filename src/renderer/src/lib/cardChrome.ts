// R12a: below 100% zoom the chrome of a canvas card (header, status line) is counter-scaled so its text is not under ~11px
// on screen (0.96 of its 100% size at most); the body scales with the canvas. Below 50% the cards are summaries: the factor stops there.
export const chromeScale = (zoom: number): number => Math.max(1, 0.96 / Math.max(zoom, 0.5));
