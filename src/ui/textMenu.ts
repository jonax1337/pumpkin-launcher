import { t } from "@/i18n";
import { toastError } from "@/lib/toast";
import type { MenuEntry } from "./Menu";

type TextField = HTMLInputElement | HTMLTextAreaElement;
type EditableSnapshot = {
  html: string;
  startNode: Node;
  startOffset: number;
  endNode: Node;
  endOffset: number;
};
export type TextContext = {
  target: HTMLElement;
  field?: TextField;
  value?: string;
  start?: number;
  end?: number;
  direction?: "forward" | "backward" | "none";
  range?: Range;
  editableSnapshot?: EditableSnapshot;
  text: string;
  editable: boolean;
  password: boolean;
};

export function captureTextContext(target: Element): TextContext | undefined {
  const field = target.closest("input, textarea");
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (field instanceof HTMLInputElement && !["text", "search", "url", "tel", "password", "email", "number"].includes(field.type)) return;
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    const password = field instanceof HTMLInputElement && field.type === "password";
    return {
      target: field, field, value: field.value, start, end,
      direction: field.selectionDirection ?? "none",
      text: password ? "" : field.value.slice(start, end),
      editable: !field.readOnly && !field.disabled,
      password,
    };
  }
  const element = target instanceof HTMLElement ? target : target.parentElement;
  const editable = element?.isContentEditable ? element.closest<HTMLElement>("[contenteditable]") : null;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
  const selectedHere = range && !range.collapsed && range.intersectsNode(target);
  if (!element || (!editable && !selectedHere)) return;
  let capturedRange = editable && range && !editable.contains(range.commonAncestorContainer) ? undefined : range;
  if (editable && !capturedRange) {
    capturedRange = document.createRange();
    capturedRange.selectNodeContents(editable);
    capturedRange.collapse(false);
  }
  return {
    target: editable ?? element,
    range: capturedRange,
    editableSnapshot: editable && capturedRange ? captureEditableSnapshot(editable, capturedRange) : undefined,
    text: capturedRange?.toString() ?? "",
    editable: !!editable && editable.getAttribute("aria-readonly") !== "true",
    password: false,
  };
}

export function restoreTextContext(context: TextContext) {
  if (!context.target.isConnected) return;
  context.target.focus({ preventScroll: true });
  if (context.field) {
    if (context.field.selectionStart !== null) {
      context.field.setSelectionRange(context.start ?? 0, context.end ?? 0, context.direction);
    }
  } else if (context.range) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(context.range);
  }
}

export function textMenuEntries(context: TextContext): MenuEntry[] {
  const run = (action: () => void | Promise<void>) => () => {
    void Promise.resolve().then(action).catch(() => {
      restoreTextContext(context);
      toastError(new Error(t("ui.context.editFailed")));
    });
  };
  const canCopy = !context.password && !!context.text && !!navigator.clipboard?.writeText;
  return [
    { id: "cut", text: t("ui.context.cut"), disabled: !context.editable || !canCopy, onSelect: run(async () => {
      await navigator.clipboard.writeText(context.text);
      replaceSelection(context, "");
    }) },
    { id: "copy", text: t("ui.context.copy"), disabled: !canCopy, onSelect: run(async () => {
      await navigator.clipboard.writeText(context.text);
      restoreTextContext(context);
    }) },
    { id: "paste", text: t("ui.context.paste"), disabled: !context.editable || !navigator.clipboard?.readText, onSelect: run(async () => {
      const text = await navigator.clipboard.readText();
      if (text === "") {
        restoreTextContext(context);
        return;
      }
      replaceSelection(context, text);
    }) },
    { id: "select-all", text: t("ui.context.selectAll"), disabled: context.field?.disabled || !(context.field?.value ?? context.target.textContent), onSelect: run(() => selectAll(context)) },
  ];
}

function replaceSelection(context: TextContext, text: string) {
  validateEditingTarget(context);
  restoreTextContext(context);
  validateEditingTarget(context);
  if (context.editableSnapshot) validateRestoredSelection(context);
  // Chromium's editing command preserves undo and emits the input event used by controlled React fields.
  if (!document.execCommand("insertText", false, text)) throw new Error("Text insertion failed");
  if (context.field) {
    context.value = context.field.value;
    context.start = context.field.selectionStart ?? 0;
    context.end = context.field.selectionEnd ?? 0;
    context.direction = context.field.selectionDirection ?? "none";
  } else {
    const selection = window.getSelection();
    context.range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
  }
}

function captureEditableSnapshot(target: HTMLElement, range: Range): EditableSnapshot {
  return {
    html: target.innerHTML,
    startNode: range.startContainer,
    startOffset: range.startOffset,
    endNode: range.endContainer,
    endOffset: range.endOffset,
  };
}

function validateEditingTarget(context: TextContext) {
  if (!context.target.isConnected || !context.editable) throw new Error("Editing target is unavailable");
  if (context.field?.readOnly || context.field?.disabled || context.target.getAttribute("aria-readonly") === "true") {
    throw new Error("Editing target is read-only");
  }
  if (context.field && context.field.value !== context.value) throw new Error("Editing target changed");
  const snapshot = context.editableSnapshot;
  if (!snapshot) return;
  if (!context.target.isContentEditable || context.target.innerHTML !== snapshot.html
    || !context.target.contains(snapshot.startNode) || !context.target.contains(snapshot.endNode)
    || !context.range || !matchesSnapshot(context.range, snapshot)) {
    throw new Error("Editing target changed");
  }
}

function matchesSnapshot(range: Range, snapshot: EditableSnapshot) {
  return range.startContainer === snapshot.startNode && range.startOffset === snapshot.startOffset
    && range.endContainer === snapshot.endNode && range.endOffset === snapshot.endOffset;
}

function validateRestoredSelection(context: TextContext) {
  const selection = window.getSelection();
  if (!context.editableSnapshot || !selection?.rangeCount
    || !matchesSnapshot(selection.getRangeAt(0), context.editableSnapshot)
    || (document.activeElement !== context.target && !context.target.contains(document.activeElement))) {
    throw new Error("Editing selection changed");
  }
}

function selectAll(context: TextContext) {
  restoreTextContext(context);
  if (context.field) {
    context.field.select();
    context.start = context.field.selectionStart ?? 0;
    context.end = context.field.selectionEnd ?? 0;
  } else {
    const range = document.createRange();
    range.selectNodeContents(context.target);
    context.range = range;
    restoreTextContext(context);
  }
}
