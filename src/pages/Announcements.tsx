import { useLayoutEffect, useRef, useState, type Ref } from "react";
import { Description } from "@/components/Description";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useI18n } from "@/i18n";
import { ANNOUNCEMENTS_URL, type Announcement } from "@/lib/announcements";
import { formatDate, formatDateTime } from "@/lib/format";
import { openPage } from "@/lib/links";
import { useAnnouncementReadStore } from "@/store/announcementRead";
import { Actions, Button, Chip, Empty, ErrorBox, Heading, Page, PageHeader, Panel, Skel, Workspace, WorkspaceRail } from "@/ui";
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
          <Button icon="refresh" disabled={feed.isFetching} onClick={() => void feed.refetch()}>
            {t("ui.context.refresh")}
          </Button>
          <Button icon="external" onClick={() => openPage(ANNOUNCEMENTS_URL)}>
            {t("pages.announcements.category")}
          </Button>
        </Actions>
      </PageHeader>
      <p role="status" className="announcements-status announcements-fetch-status">
        {feed.isFetchingNextPage ? t("pages.announcements.loadingMore")
          : feed.isFetching && feed.data ? t("pages.announcements.refreshing")
          : feed.isPending ? t("pages.announcements.loading") : ""}
      </p>
      {feed.isPending && <Skel h={320} />}
      {feed.isError && !feed.isFetchNextPageError && (
        <ErrorBox
          title={t(feed.data ? "pages.announcements.refreshError" : "pages.announcements.loadError")}
          error={feed.error}
          onRetry={feed.isFetching ? undefined : () => void feed.refetch()}
        />
      )}
      {feed.data && announcements.length === 0 && !feed.isError && (
        <Empty title={t("pages.announcements.emptyTitle")}>
          {t("pages.announcements.emptyBody")}
        </Empty>
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
                  <Button width="full" disabled={feed.isFetching} onClick={() => void feed.fetchNextPage()}>
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
    <ul className="announcements-list">
      {announcements.map((announcement) => {
        const isRead = readIds.has(announcement.id);
        return (
          <li key={announcement.id}>
            <button
              type="button"
              className="announcement-list-item"
              aria-current={selectedId === announcement.id ? "true" : undefined}
              onClick={() => onSelect(announcement)}
            >
              <span className="announcement-list-meta">
                <time dateTime={announcement.published}>{formatDate(Date.parse(announcement.published))}</time>
                {isRead ? <span className="sr">{t("pages.announcements.read")}</span> : <Chip size="s" tone="acc">{t("pages.announcements.unread")}</Chip>}
              </span>
              <span className="announcement-list-title">{announcement.title}</span>
              <span className="announcement-list-author">{t("pages.announcements.author", { author: announcement.author })}</span>
            </button>
          </li>
        );
      })}
    </ul>
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
        <Heading level="section" id="announcements-preview-title" className="announcements-latest-title">{latest.title}</Heading>
        <AnnouncementMeta announcement={latest} />
        <p className="announcements-excerpt">{excerpt(latest.body)}</p>
        <Button variant="primary" onClick={() => onSelect(latest)}>
          {t("pages.announcements.readAnnouncement")}
        </Button>
      </div>
    </Panel>
  );
}

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
            variant="ghost"
            size="s"
            onClick={() => isRead ? markUnread(announcement.id) : markRead(announcement.id)}
          >
            {t(isRead ? "pages.announcements.markUnread" : "pages.announcements.markRead")}
          </Button>
        </div>
        <Heading level="section" id="announcement-title" className="announcement-title" ref={headingRef} tabIndex={-1}>
          {announcement.title}
        </Heading>
        <AnnouncementMeta announcement={announcement} />
        <Button variant="ghost" size="s" icon="external" onClick={() => openPage(announcement.url)}>
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
