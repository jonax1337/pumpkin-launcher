import { ButtonLink, Empty, Page, PageHeader } from "@/ui";
import { Buddy } from "@/branding/Brand";
import { useI18n } from "@/i18n";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <Page>
      <PageHeader title={t("ui.pageTitle.notFound")} />
      <Empty
        ill={<Buddy mood="oops" size={144} />}
        title="404"
        as="h2"
        actions={<ButtonLink to="/" variant="primary" icon="arrow-left">{t("pages.notFound.backToHome")}</ButtonLink>}
      >
        {t("pages.notFound.body")}
      </Empty>
    </Page>
  );
}
