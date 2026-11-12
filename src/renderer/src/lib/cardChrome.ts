// R12a (SPEC 11.2): below 100% zoom the chrome of a canvas card is drawn in screen pixels (header 28, footer 24): its sizes are
// written in CSS as N * var(--iz), --iz being 1 / zoom, and the card carries data-zoomed. From 100% up the card is as in mock 06.
export const invZoom = (zoom: number): number => zoom < 1 ? 1 / zoom : 1;
export const zoomedAttr = (zoom: number): "" | undefined => zoom < 1 ? "" : undefined;
