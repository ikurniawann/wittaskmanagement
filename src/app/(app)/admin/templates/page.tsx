import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PriorityIcon } from "@/components/task-meta";
import { sessionActor } from "@/lib/auth/session-actor";
import { listDivisions } from "@/lib/org/service";
import { can } from "@/lib/permissions";
import { getTemplate, listTemplates } from "@/lib/templates/service";
import { deleteItemAction, deleteTemplateAction } from "./actions";
import { AddItemForm, NewTemplateForm } from "./template-forms";

export const metadata: Metadata = { title: "Playbooks" };

// T-090: playbook editor — per-division checklist items with lead times.
export default async function TemplatesPage({
  searchParams,
}: PageProps<"/admin/templates">) {
  const actor = await sessionActor();
  if (!actor || !can(actor, "org.manage")) redirect("/my-tasks");

  const sp = await searchParams;
  const templates = await listTemplates();
  const selectedId =
    (typeof sp.t === "string" ? sp.t : undefined) ?? templates[0]?.template.id;
  const selected = selectedId ? await getTemplate(selectedId) : null;
  const divisions = await listDivisions();

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin"
          className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Project playbooks
        </h1>
        <p className="text-sm text-muted-foreground">
          Reusable checklists per division — due dates count back from show
          day when a playbook is applied to a project.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {templates.map(({ template, itemCount }) => (
          <Link
            key={template.id}
            href={`/admin/templates?t=${template.id}`}
            className={
              "rounded-full border px-3 py-1.5 text-xs transition-all " +
              (template.id === selectedId
                ? "border-foreground bg-foreground font-medium text-background"
                : "text-muted-foreground hover:border-foreground/40 hover:text-foreground")
            }
          >
            {template.name} · {itemCount}
          </Link>
        ))}
        <NewTemplateForm />
      </div>

      {selected ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{selected.description}</p>
            <form action={deleteTemplateAction}>
              <input type="hidden" name="templateId" value={selected.id} />
              <button
                type="submit"
                className="text-xs text-muted-foreground transition-colors hover:text-destructive"
              >
                Delete template
              </button>
            </form>
          </div>

          <AddItemForm
            templateId={selected.id}
            divisions={divisions.map((d) => ({ id: d.id, name: d.name }))}
          />

          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Division</th>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 text-right font-medium">Lead time</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {selected.items.map(({ item, divisionName }) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {divisionName}
                    </td>
                    <td className="px-4 py-2 font-medium">{item.title}</td>
                    <td className="px-4 py-2">
                      <PriorityIcon priority={item.priority} withLabel />
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums">
                      {item.offsetDays >= 0
                        ? `H−${item.offsetDays}`
                        : `H+${Math.abs(item.offsetDays)}`}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <form action={deleteItemAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <button
                          type="submit"
                          aria-label={`Delete ${item.title}`}
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          ×
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No playbooks yet — create one above.
        </p>
      )}
    </section>
  );
}
