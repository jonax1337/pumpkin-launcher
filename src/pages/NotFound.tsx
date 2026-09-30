import { ButtonLink, Empty } from "@/ui";
import { Buddy } from "@/branding/Brand";

export function NotFoundPage() {
  return (
    <section className="page">
      <Empty
        ill={<Buddy mood="oops" size={144} />}
        title="Seite nicht gefunden"
        asPage
        actions={<ButtonLink to="/" variant="primary" icon="back">Zum Start</ButtonLink>}
      >
        Diese Adresse gibt es in Pumpkin Launcher nicht (mehr).
      </Empty>
    </section>
  );
}
