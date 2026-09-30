import { ButtonLink, Empty, Glyph } from "@/ui";

export function NotFoundPage() {
  return (
    <section className="page">
      <Empty
        ill={<Glyph name="compass" pal="ice" box={64} />}
        title="Seite nicht gefunden"
        asPage
        actions={<ButtonLink to="/" variant="primary" icon="back">Zum Start</ButtonLink>}
      >
        Diese Adresse gibt es in Voxlet nicht (mehr).
      </Empty>
    </section>
  );
}
