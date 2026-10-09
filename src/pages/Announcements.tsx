import { useLayoutEffect, useRef, useState, type Ref } from "react";
import { Description } from "@/components/Description";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useI18n } from "@/i18n";
import { ANNOUNCEMENTS_URL, type Announcement } from "@/lib/announcements";
import { formatDate, formatDateTime } from "@/lib/format";
import { openPage } from "@/lib/links";
import { useAnnouncementReadStore } from "@/store/announcementRead";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBox } from "@/components/ErrorBox";
import { Actions, Button, Chip, Heading, List, ListRow, Page, PageHeader, Panel, RowTitle, Skel, Workspace, WorkspaceRail } from "@/ui";
import "./announcements.css";

function uniqueAnnouncements(pages: Announcement[][]): Announcement[] {
  const seen = new Set<string>();
  return pages.flat().filter((announcement) => {
    if (seen.has(announcement.id)) return false;
    seen.add(announcement.id);
    return true;
  });
}

/** Länge des Auszugs in der Vorschau. */
const EXCERPT_LENGTH = 280;

/** Beitragstext ohne Markup, auf `EXCERPT_LENGTH` Zeichen gekürzt (DOMParser führt nichts aus). */
function excerpt(html: string): string {
  const text = (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()} …` : text;
}

export function AnnouncementsPage() {
  const { t } = useI18n();
  const feed = useAnnouncements();
  const readIds = useAnnouncementReadStore((state) => state.readIds);
  const markRead = useAnnouncementReadStore((state) => state.markRead);
  const markAllRead = useAnnouncementReadStore((state) => state.markAllRead);
  const [selection, setSelection] = useState<Announcement | null>(null);
  const articleHeading = useRef<HTMLHeadingElement>(null);
  const announcements = uniqueAnnouncements(feed.data?.pages ?? []);
  const readSet = new Set(readIds);
  const unreadCount = announcements.filter((announcement) => !readSet.has(announcement.id)).length;
  const selected = announcements.find((announcement) => announcement.id === selection?.id) ?? selection;

  // Only a deliberate selection moves focus, never a feed refresh or a read-state change.
  useLayoutEffect(() => {
    if (selection) articleHeading.current?.focus();
  }, [selection]);

  function selectAnnouncement(announcement: Announcement) {
    markRead(announcement.id);
    setSelection(announcement);
    if (selection === announcement) articleHeading.current?.focus();
  }

  return (
    <Page className="announcements-page">
      <PageHeader title={t("ui.nav.announcements")}>
        <Actions wrap>
          <Button wrap icon="refresh" disabled={feed.isFetching} onClick={() => void feed.refetch()}>
            {t("ui.context.refresh")}
          </Button>
          <Button wrap icon="external" onClick={() => openPage(ANNOUNCEMENTS_URL)}>
            {t("pages.announcements.category")}
          </Button>
        </Actions>
      </PageHeader>
      <p role="status" className="announcements-status announcements-fetch-status">
        {feed.isFetchingNextPage ? t("pages.announcements.loadingMore")
          : feed.isFetching && feed.data ? t("pages.announcements.refreshing")
          : feed.isPending ? t("pages.announcements.loading") : ""}
      </p>
      {feed.isPending && <Skel className="h-80" />}
      {feed.isError && !feed.isFetchNextPageError && (
        <ErrorBox
          title={t(feed.data ? "pages.announcements.refreshError" : "pages.announcements.loadError")}
          error={feed.error}
          onRetry={feed.isFetching ? undefined : () => void feed.refetch()}
        />
      )}
      {feed.data && announcements.length === 0 && !feed.isError && (
        <EmptyState title={t("pages.announcements.emptyTitle")}>
          {t("pages.announcements.emptyBody")}
        </EmptyState>
      )}
      {announcements.length > 0 && (
        <Workspace rail={
          <WorkspaceRail className="announcements-rail" aria-labelledby="announcements-list-title">
            <div className="announcements-rail-header">
              <div className="announcements-rail-title">
                <Heading level="section" id="announcements-list-title">{t("pages.announcements.listTitle")}</Heading>
                {unreadCount > 0 && (
                  <Chip tone="acc" role="status">
                    {t("pages.announcements.unreadCount", { count: unreadCount })}
                  </Chip>
                )}
              </div>
              <Button
                wrap
                size="s"
                variant="ghost"
                icon="check"
                disabled={unreadCount === 0}
                onClick={() => markAllRead(announcements.map((announcement) => announcement.id))}
              >
                {t("pages.announcements.markLoadedRead")}
              </Button>
            </div>
            <AnnouncementList
              announcements={announcements}
              readIds={readSet}
              selectedId={selected?.id}
              onSelect={selectAnnouncement}
            />
            {(feed.hasNextPage || feed.isFetchNextPageError) && (
              <div className="announcements-rail-footer">
                {feed.isFetchNextPageError && (
                  <ErrorBox
                    title={t("pages.announcements.moreError")}
                    error={feed.error}
                    onRetry={feed.isFetching ? undefined : () => void feed.fetchNextPage()}
                  />
                )}
                {feed.hasNextPage && !feed.isFetchNextPageError && (
                  <Button wrap className="w-full" disabled={feed.isFetching} onClick={() => void feed.fetchNextPage()}>
                    {t(feed.isFetchingNextPage ? "pages.announcements.loadingMore" : "pages.announcements.loadMore")}
                  </Button>
                )}
              </div>
            )}
          </WorkspaceRail>
        }>
          {selected ? (
            <AnnouncementArticle announcement={selected} headingRef={articleHeading} />
          ) : (
            <AnnouncementPreview latest={announcements[0]!} onSelect={selectAnnouncement} />
          )}
        </Workspace>
      )}
    </Page>
  );
}

function AnnouncementList({ announcements, readIds, selectedId, onSelect }: {
  announcements: Announcement[];
  readIds: ReadonlySet<string>;
  selectedId: string | undefined;
  onSelect: (announcement: Announcement) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="max-h-[max(280px,calc(100dvh_-_360px))] overflow-y-auto overscroll-y-contain le-960:max-h-[260px]">
      <List feed aria-label={t("pages.announcements.listTitle")}>
        {announcements.map((announcement) => {
          const isRead = readIds.has(announcement.id);
          const isSelected = selectedId === announcement.id;
          return (
            <ListRow key={announcement.id} hit={{ onClick: () => onSelect(announcement), label: `${announcement.title}, ${t(isRead ? "pages.announcements.read" : "pages.announcements.unread")}` }} selected={isSelected} current={isSelected}>
              <RowTitle
                size="display"
                eyebrow={
                  <>
                    <time dateTime={announcement.published}>{formatDate(Date.parse(announcement.published))}</time>
                    {isRead ? <span className="sr">{t("pages.announcements.read")}</span> : <Chip size="s" tone="acc">{t("pages.announcements.unread")}</Chip>}
                  </>
                }
                title={announcement.title}
                sub={t("pages.announcements.author", { author: announcement.author })}
              />
            </ListRow>
          );
        })}
      </List>
    </div>
  );
}

function AnnouncementPreview({ latest, onSelect }: {
  latest: Announcement;
  onSelect: (announcement: Announcement) => void;
}) {
  const { t } = useI18n();
  return (
    <Panel as="section" className="announcements-preview" aria-labelledby="announcements-preview-title">
      <div className="announcements-latest">
        <p className="announcements-eyebrow">{t("pages.announcements.latest")}</p>
        <Heading level="section" id="announcements-preview-title" className="text-hd-hero leading-[1.1] max-w-[32ch] [overflow-wrap:anywhere]">{latest.title}</Heading>
        <AnnouncementMeta announcement={latest} />
        <p className="announcements-excerpt">{excerpt(latest.body)}</p>
        <Button wrap variant="primary" className="mt-6" onClick={() => onSelect(latest)}>
          {t("pages.announcements.readAnnouncement")}
        </Button>
      </div>
    </Panel>
  );
}

/** Titel des Beitrags: Größe der Szene, bekommt nach der Auswahl den Fokus und zeigt ihn als Umriss (kein Bedienelement, aber Ziel des Fokus). */
const ARTICLE_TITLE = [
  "text-hd-hero leading-[1.1] w-fit max-w-[min(100%,32ch)] scroll-mt-6 [overflow-wrap:anywhere]",
  "focus-visible:outline-(length:--px) focus-visible:outline-solid focus-visible:outline-(color:--focus) focus-visible:outline-offset-2 forced-colors:focus-visible:outline-[Highlight]",
].join(" ");

function AnnouncementArticle({ announcement, headingRef }: {
  announcement: Announcement;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const { t } = useI18n();
  const isRead = useAnnouncementReadStore((state) => state.readIds.includes(announcement.id));
  const markRead = useAnnouncementReadStore((state) => state.markRead);
  const markUnread = useAnnouncementReadStore((state) => state.markUnread);

  return (
    <Panel as="article" className="announcement-article" aria-labelledby="announcement-title">
      <header className="announcement-article-header">
        <div className="announcement-article-actions">
          <Chip tone={isRead ? "run" : "acc"} icon={isRead ? "check" : undefined} role="status">
            {t(isRead ? "pages.announcements.read" : "pages.announcements.unread")}
          </Chip>
          <Button
            wrap
            variant="ghost"
            size="s"
            onClick={() => isRead ? markUnread(announcement.id) : markRead(announcement.id)}
          >
            {t(isRead ? "pages.announcements.markUnread" : "pages.announcements.markRead")}
          </Button>
        </div>
        <Heading level="section" id="announcement-title" className={ARTICLE_TITLE} ref={headingRef} tabIndex={-1}>
          {announcement.title}
        </Heading>
        <AnnouncementMeta announcement={announcement} />
        <Button wrap variant="ghost" size="s" icon="external" className="mt-3.5" onClick={() => openPage(announcement.url)}>
          {t("pages.announcements.discussion")}
        </Button>
      </header>
      <Description key={announcement.id} body={announcement.body} format="html" />
    </Panel>
  );
}

function AnnouncementMeta({ announcement }: { announcement: Announcement }) {
  const { t } = useI18n();
  const published = Date.parse(announcement.published);
  return (
    <div className="announcement-meta">
      <span>{t("pages.announcements.author", { author: announcement.author })}</span>
      {Number.isFinite(published) && (
        <time dateTime={announcement.published}>{formatDateTime(published)}</time>
      )}
    </div>
  );
}
