// Ersetzt den Bereich zwischen `<!-- NAME:begin -->` und `<!-- NAME:end -->` in einem Dokument.

export function replaceRegion(documentText, regionName, content) {
  const begin = `<!-- ${regionName}:begin -->`;
  const end = `<!-- ${regionName}:end -->`;
  const beginIndex = documentText.indexOf(begin);
  const endIndex = documentText.indexOf(end);
  if (beginIndex < 0 || endIndex < beginIndex) throw new Error(`Marker ${begin} ... ${end} fehlen im Dokument`);
  return `${documentText.slice(0, beginIndex + begin.length)}\n\n${content}\n\n${documentText.slice(endIndex)}`;
}
