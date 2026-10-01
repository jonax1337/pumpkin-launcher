import { useMemo, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { openPage } from "@/lib/links";
import { cn } from "@/lib/utils";

// Nur https-Bilder, nur http(s)-Links; Skripte und Event-Handler entfernt DOMPurify ohnehin.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "IMG") {
    if (!/^https:\/\//i.test(node.getAttribute("src") ?? "")) node.removeAttribute("src");
    node.setAttribute("loading", "lazy");
    node.setAttribute("referrerpolicy", "no-referrer");
  }
  if (node.tagName === "A" && !/^https?:\/\//i.test(node.getAttribute("href") ?? "")) node.removeAttribute("href");
});
const PURIFY = {
  FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "svg", "math", "video", "audio", "source", "picture"],
  FORBID_ATTR: ["style", "class", "id", "srcset", "target"],
};

/**
 * Reihen verlinkter Bild-Knöpfe („How to install“, „Discord“, Badges) als ruhige Textlinks aus dem Alt-Text,
 * damit fremd gestaltete Knöpfe nicht neben denen der App stehen. Einzelne verlinkte Bilder (Videos, Screenshots) bleiben.
 */
function badgeRowsAsLinks(root: DocumentFragment) {
  for (const p of root.querySelectorAll("p")) {
    const links = [...p.children];
    const badges = links.length > 1 && !p.textContent?.trim() && links.every((a) => a.tagName === "A" && a.children.length === 1 && a.firstElementChild?.tagName === "IMG");
    if (!badges) continue;
    p.className = "badges";
    for (const a of links) a.replaceChildren(a.firstElementChild!.getAttribute("alt")?.trim() || new URL((a as HTMLAnchorElement).href || "https://link").hostname);
  }
}

/** Projektbeschreibung im Pixelkino-Stil (`.desc`). Links öffnen im Standardbrowser. */
export function Description({ body, className }: { body: string; className?: string }) {
  const html = useMemo(() => {
    const doc = DOMPurify.sanitize(marked.parse(body, { async: false }), { ...PURIFY, RETURN_DOM_FRAGMENT: true });
    badgeRowsAsLinks(doc);
    const box = document.createElement("div");
    box.append(doc);
    return box.innerHTML;
  }, [body]);
  function onLink(e: MouseEvent) {
    const link = (e.target as Element).closest("a");
    if (!link) return;
    e.preventDefault();
    if (/^https?:/.test(link.href)) openPage(link.href);
  }
  return <div onClick={onLink} onAuxClick={onLink} className={cn("desc md", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
