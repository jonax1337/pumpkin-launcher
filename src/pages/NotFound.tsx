import { BtnLink, Empty } from "@/components/px";
import { Glyph } from "@/pixel/icons";

export function NotFoundPage() {
  return (
    <section className="page">
      <Empty
        ill={<Glyph name="compass" pal="ice" big />}
        title="Seite nicht gefunden"
        actions={<BtnLink to="/" variant="p" icon="back">Zum Start</BtnLink>}
      >
        Diese Adresse gibt es in Voxlet nicht (mehr).
      </Empty>
    </section>
  );
}
