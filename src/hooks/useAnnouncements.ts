import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { parseAnnouncements } from "@/lib/announcements";
import { MINUTE } from "@/lib/time";
import { announcementKeys } from "./queryKeys";

export function useAnnouncements(refetchInterval?: number) {
  return useInfiniteQuery({
    queryKey: announcementKeys.all,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => parseAnnouncements(await api.announcementFeed(pageParam)),
    getNextPageParam: (lastPage, _pages, lastPageParam) => lastPage.length ? lastPageParam + 1 : undefined,
    staleTime: 5 * MINUTE,
    refetchInterval,
  });
}
