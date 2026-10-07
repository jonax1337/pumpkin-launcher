export const ANNOUNCEMENTS_URL = "https://github.com/jonax1337/pumpkin-launcher/discussions/categories/announcements";

const ATOM_NAMESPACE = "http://www.w3.org/2005/Atom";
const DISCUSSION_URL = /^https:\/\/github\.com\/jonax1337\/pumpkin-launcher\/discussions\/[1-9]\d*$/;

export interface Announcement {
  id: string;
  title: string;
  url: string;
  author: string;
  published: string;
  body: string;
}

function atomChild(parent: Element, name: string): Element | undefined {
  return [...parent.children].find((child) => child.namespaceURI === ATOM_NAMESPACE && child.localName === name);
}

function requiredText(parent: Element, name: string): string {
  const text = atomChild(parent, name)?.textContent?.trim();
  if (!text) throw new Error(`GitHub announcement is missing ${name}.`);
  return text;
}

function parseEntry(entry: Element): Announcement {
  const link = [...entry.children].find((child) =>
    child.namespaceURI === ATOM_NAMESPACE && child.localName === "link" && child.getAttribute("rel") === "alternate");
  const url = link?.getAttribute("href") ?? "";
  const published = requiredText(entry, "published");
  const author = atomChild(entry, "author");
  const content = atomChild(entry, "content");
  if (!DISCUSSION_URL.test(url) || !Number.isFinite(Date.parse(published)) || !author || content?.getAttribute("type") !== "html") {
    throw new Error("GitHub returned an invalid announcement.");
  }
  return {
    id: requiredText(entry, "id"),
    title: requiredText(entry, "title"),
    url,
    author: requiredText(author, "name"),
    published,
    body: content.textContent ?? "",
  };
}

/** Decode Atom's escaped HTML once; Description sanitizes it before rendering. */
export function parseAnnouncements(xml: string): Announcement[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const feed = doc.documentElement;
  if (doc.querySelector("parsererror") || feed.localName !== "feed" || feed.namespaceURI !== ATOM_NAMESPACE) {
    throw new Error("GitHub returned an invalid announcements feed.");
  }
  return [...feed.children]
    .filter((child) => child.namespaceURI === ATOM_NAMESPACE && child.localName === "entry")
    .map(parseEntry);
}
