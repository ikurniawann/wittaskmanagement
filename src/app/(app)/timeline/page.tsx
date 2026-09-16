import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { redirect } from "next/navigation";
import { AttachmentView } from "@/components/attachment-view";
import { CommentBody } from "@/components/comment-body";
import { EventChip } from "@/components/event-chip";
import { UserAvatar } from "@/components/task-meta";
import { sessionActor } from "@/lib/auth/session-actor";
import {
  getUnreadCounts,
  listMentions,
  listTimeline,
  markSeen,
  type TimelinePost,
} from "@/lib/timeline/service";
import { cn } from "@/lib/utils";
import { ThreadView } from "./thread-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Timeline" };

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

function Post({ post }: { post: TimelinePost }) {
  return (
    <li className="flex gap-3 px-4 py-4">
      <UserAvatar name={post.authorName} className="mt-0.5 size-9 text-xs" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold">{post.authorName}</span>
          <span className="text-xs text-muted-foreground">
            · {timeAgo(post.createdAt)}
          </span>
          <EventChip name={post.eventName} className="hidden sm:inline-flex" />
        </div>
        <Link
          href={`/tasks/${post.taskId}`}
          className="w-fit text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          on “{post.taskTitle}” · {post.divisionName}
        </Link>
        <CommentBody body={post.body} mentionNames={post.mentionNames} />
        {post.attachmentPath ? (
          <AttachmentView path={post.attachmentPath} name={post.attachmentName} />
        ) : null}
        <ThreadView taskId={post.taskId} commentCount={post.commentCount} />
      </div>
    </li>
  );
}

export default async function TimelinePage({
  searchParams,
}: PageProps<"/timeline">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const sp = await searchParams;
  const tab = sp.tab === "mentions" ? "mentions" : "timeline";

  // opening a tab clears its badge
  await markSeen(actor, tab);
  const [posts, counts] = await Promise.all([
    tab === "mentions" ? listMentions(actor) : listTimeline(actor),
    getUnreadCounts(actor),
  ]);

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader title={<>Timeline</>} description={<>What every division is talking about, as it happens.</>} />

      <div className="flex gap-1 border-b">
        {(
          [
            { key: "timeline", label: "Timeline", badge: counts.timeline },
            { key: "mentions", label: "Mentions", badge: counts.mentions },
          ] as const
        ).map((t) => (
          <Link
            key={t.key}
            href={t.key === "timeline" ? "/timeline" : "/timeline?tab=mentions"}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.key !== tab && t.badge > 0 ? (
              <span className="flex size-4.5 items-center justify-center rounded-full bg-foreground text-[9px] font-semibold text-background">
                {t.badge > 9 ? "9+" : t.badge}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      {posts.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={tab === "mentions" ? "No mentions yet" : "No activity yet"}
          hint={
            tab === "mentions"
              ? "When someone @mentions you in a task comment, it lands here."
              : "Comments and attachments on any task show up here as a feed."
          }
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-card bg-card shadow-card">
          {posts.map((post) => (
            <Post key={post.id} post={post} />
          ))}
        </ul>
      )}
    </section>
  );
}
