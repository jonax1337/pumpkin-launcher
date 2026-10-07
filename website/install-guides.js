export function enhanceInstallGuides() {
  const dialog = document.getElementById("install-guide");
  if (!dialog || typeof dialog.showModal !== "function") return () => {};

  const title = document.getElementById("install-guide-title");
  const content = dialog.querySelector(".install-dialog-content");
  const panels = [...dialog.querySelectorAll("[data-guide-platform]")];
  const buttons = [...document.querySelectorAll("[data-install-guide]")];
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let opener;
  let backdropPressed = false;

  function openGuide(event) {
    const button = event.currentTarget;
    const platform = button.dataset.installGuide;
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.guidePlatform !== platform;
    });
    title.textContent = `${button.closest("[data-os-name]").dataset.osName} installation guide`;
    opener = button;
    backdropPressed = false;
    dialog.showModal();
    dialog.scrollTop = 0;
    content.scrollTop = 0;
    title.focus({ preventScroll: true });
  }

  function restoreFocus() {
    if (dialog.open) return;
    opener?.focus({ preventScroll: true });
    opener = undefined;
    backdropPressed = false;
  }

  function cycleFocus(event) {
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll("button:not([disabled]), a[href]")].filter((element) => element.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === title)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function isBackdrop(event) {
    if (event.target !== dialog) return false;
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }

  dialog.addEventListener("pointerdown", (event) => {
    backdropPressed = event.button === 0 && isBackdrop(event);
  }, options);
  dialog.addEventListener("pointercancel", () => { backdropPressed = false; }, options);
  dialog.addEventListener("click", (event) => {
    if (backdropPressed && isBackdrop(event)) dialog.close();
    backdropPressed = false;
  }, options);
  dialog.addEventListener("close", restoreFocus, options);
  dialog.addEventListener("keydown", cycleFocus, options);
  buttons.forEach((button) => {
    button.addEventListener("click", openGuide, options);
    button.hidden = false;
  });

  return () => {
    if (dialog.open) dialog.close();
    restoreFocus();
    listeners.abort();
    buttons.forEach((button) => { button.hidden = true; });
  };
}
