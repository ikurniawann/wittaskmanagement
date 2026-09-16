import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionActor } from "@/lib/auth/session-actor";
import { can } from "@/lib/permissions";
import { listEditableTemplates } from "@/lib/whatsapp/template-store";
import { TEMPLATE_SPECS } from "@/lib/whatsapp/templates";
import { TemplateEditorList } from "./template-editor";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Notification templates" };

// T-152: admin-only editor for the WhatsApp wording. Same org.manage gate as
// the rest of /admin — a Head or member never reaches this route.
export default async function NotificationTemplatesPage() {
  const actor = await sessionActor();
  if (!actor || !can(actor, "org.manage")) redirect("/my-tasks");

  const bodies = await listEditableTemplates();

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin"
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Admin
        </Link>
        <PageHeader title={<>Notification templates</>} description={<>The wording of the WhatsApp messages the app sends. Edit freely —
          any language works. Placeholders in braces are filled in per
          recipient; leave a template alone to keep the default wording.</>} />
      </div>

      <TemplateEditorList specs={TEMPLATE_SPECS} bodies={bodies} />

      <p className="max-w-2xl text-xs text-muted-foreground">
        A message only reaches someone who has a phone number saved and
        WhatsApp notifications switched on in their own Settings, and only
        while the gateway on the Admin page is connected.
      </p>
    </section>
  );
}
