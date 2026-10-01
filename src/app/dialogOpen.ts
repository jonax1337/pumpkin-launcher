/** Offener Dialog (auch Rückfrage); Popover und Menüs zählen nicht. */
export const dialogOpen = () => !!document.querySelector("[role=alertdialog][data-state=open], [role=dialog][aria-modal=true]");
