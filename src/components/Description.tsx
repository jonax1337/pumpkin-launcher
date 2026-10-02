import { useMemo, type KeyboardEvent, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useI18n } from "@/i18n";
import { isTrustedImageUrl, parseHttpsUrl } from "@/lib/image-hosts";
import { openPage } from "@/lib/links";
import { cn } from "@/lib/utils";

/** Platzhalter für ein Bild von einem fremden Host; erst der Klick lädt es und verrät dem Host die IP-Adresse. */
const GATE_ATTR = "data-remote-image";
const GATE_ALT_ATTR = "data-remote-alt";

// Nur Bilder der vertrauten Hosts, nur http(s)-Links; Skripte und Event-Handler entfernt DOMPurify ohnehin.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "IMG") {
    if (!isTrustedImageUrl(node.getAttribute("src") ?? "")) node.removeAttribute("src");
    node.setAttribute("loading", "lazy");
    node.setAttribute("referrerpolicy", "no-referrer");
  }
  if (node.tagName === "A" && !/^https?:\/\//i.test(node.getAttribute("href") ?? "")) node.removeAttribute("href");
});
const PURIFY = {
  FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "svg", "math", "video", "audio", "source", "picture"],
  FORBID_ATTR: ["style", "class", "id", "srcset", "target", "background", "poster", "lowsrc", "dynsrc", "longdesc"],
};

/**
 * Reihen verlinkter Bild-Knöpfe („How to install“, „Discord“, Badges) als ruhige Textlinks aus dem Alt-Text,
 * damit fremd gestaltete Knöpfe nicht neben denen der App stehen. Einzelne verlinkte Bilder (Videos, Screenshots) bleiben.
 */
function badgeRowsAsLinks(root: Document) {
  for (const p of root.querySelectorAll("p")) {
    const links = [...p.children];
    const badges = links.length > 1 && !p.textContent?.trim() && links.every((a) => a.tagName === "A" && a.children.length === 1 && a.firstElementChild?.tagName === "IMG");
    if (!badges) continue;
    p.setAttribute("data-badges", "");
    for (const a of links) a.replaceChildren(a.firstElementChild!.getAttribute("alt")?.trim() || new URL((a as HTMLAnchorElement).href || "https://link").hostname);
  }
}

/** Bilder fremder https-Hosts durch einen Platzhalter ersetzen, alle anderen (http, data:, kaputte Adressen) entfernen. */
function gateUntrustedImages(root: Document, label: (host: string) => string) {
  // Ein Platzhalter aus der Fremdbeschreibung selbst wäre ein getarnter Lade-Knopf.
  for (const forged of root.querySelectorAll(`[${GATE_ATTR}]`)) forged.removeAttribute(GATE_ATTR);
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    const url = parseHttpsUrl(src);
    if (url && isTrustedImageUrl(src)) continue;
    if (!url) {
      img.remove();
      continue;
    }
    const gate = root.createElement("span");
    gate.setAttribute(GATE_ATTR, src);
    gate.setAttribute(GATE_ALT_ATTR, img.getAttribute("alt") ?? "");
    gate.setAttribute("role", "button");
    gate.setAttribute("tabindex", "0");
    gate.textContent = label(url.hostname);
    img.replaceWith(gate);
  }
}

/** Das Bild hinter einem Platzhalter laden, nachdem der Spieler darauf geklickt hat. */
function loadGatedImage(gate: Element) {
  // Die Adresse steht als Attribut im DOM: nur eine https-Adresse wird geladen, sonst bleibt der Platzhalter.
  const url = parseHttpsUrl(gate.getAttribute(GATE_ATTR) ?? "");
  if (!url) return;
  const img = document.createElement("img");
  img.referrerPolicy = "no-referrer";
  img.loading = "lazy";
  img.alt = gate.getAttribute(GATE_ALT_ATTR) ?? "";
  img.src = url.href;
  gate.replaceWith(img);
}

/**
 * Markdown als bereinigtes HTML. Zuletzt läuft DOMPurify und liefert den String unverändert zurück:
 * Ein nachträgliches Umbauen und erneutes Serialisieren des bereinigten DOM öffnete mXSS.
 */
function renderBody(body: string, gateLabel: (host: string) => string): string {
  const doc = new DOMParser().parseFromString(marked.parse(body, { async: false }), "text/html");
  badgeRowsAsLinks(doc);
  gateUntrustedImages(doc, gateLabel);
  return DOMPurify.sanitize(doc.body.innerHTML, PURIFY);
}

/** Projektbeschreibung im Pixelkino-Stil (`.desc`). Links öffnen im Standardbrowser, Bilder fremder Hosts erst nach Klick. */
export function Description({ body, className }: { body: string; className?: string }) {
  const { t, resolved } = useI18n();
  // `resolved` neu auswerten, damit die Platzhalter beim Sprachwechsel mitziehen.
  const html = useMemo(() => renderBody(body, (host) => t("components.description.loadImage", { host })), [body, t, resolved]);
  function onClick(e: MouseEvent) {
    const target = e.target as Element;
    const gate = target.closest(`[${GATE_ATTR}]`);
    if (gate) {
      e.preventDefault();
      loadGatedImage(gate);
      return;
    }
    const link = target.closest("a");
    if (!link) return;
    e.preventDefault();
    if (/^https?:/.test(link.href)) openPage(link.href);
  }
  function onKeyDown(e: KeyboardEvent) {
    const gate = (e.target as Element).closest(`[${GATE_ATTR}]`);
    if (!gate || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    loadGatedImage(gate);
  }
  return <div onClick={onClick} onAuxClick={onClick} onKeyDown={onKeyDown} className={cn("desc md", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
