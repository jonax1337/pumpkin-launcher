import { ButtonLink, Empty } from "@/ui";
import { Buddy } from "@/branding/Brand";
import { useI18n } from "@/i18n";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <section className="page">
      <Empty
        ill={<Buddy mood="oops" size={144} />}
        title={t("pages.notFound.title")}
        asPage
        actions={<ButtonLink to="/" variant="primary" icon="back">{t("pages.notFound.backToHome")}</ButtonLink>}
      >
        {t("pages.notFound.body")}
      </Empty>
    </section>
  );
}
