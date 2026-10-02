/** Radix setzt kein aria-modal; Popover (vx-pop) und nicht-modales Seitenpanel (vx-sheet) tragen ebenfalls role=dialog. */
const OPEN_DIALOG = ":is([role=alertdialog], [role=dialog]):not(.vx-pop, .vx-sheet)[data-state=open]";

/** Offener Dialog (auch Rückfrage und Lightbox); Popover, Menüs und das Seitenpanel zählen nicht. */
export const dialogOpen = () => !!document.querySelector(OPEN_DIALOG);
