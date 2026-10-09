/** Radix setzt kein aria-modal; Popover und nicht-modales Seitenpanel des Kits tragen ebenfalls role=dialog und stehen als `data-kit-overlay` (popover, sheet) im Dokument. */
const OPEN_DIALOG = ":is([role=alertdialog], [role=dialog]):not([data-kit-overlay=popover], [data-kit-overlay=sheet])[data-state=open]";

/** Offener Dialog (auch Rückfrage und Lightbox); Popover, Menüs und das Seitenpanel zählen nicht. */
export const dialogOpen = () => !!document.querySelector(OPEN_DIALOG);
