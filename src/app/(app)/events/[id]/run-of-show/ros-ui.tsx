"use client";

import { Pencil, Printer } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  rosAddAction,
  rosDeleteAction,
  rosUpdateAction,
  type RosActionState,
} from "./actions";

export interface RosItem {
  id: string;
  startTime: string;
  durationMinutes: number | null;
  title: string;
  note: string;
}

export function PrintButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="size-3.5" /> Print
    </Button>
  );
}

function ItemFields({ item }: { item?: RosItem }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label>Start (HH:MM)</Label>
        <Input
          name="startTime"
          required
          placeholder="18:30"
          pattern="([01]\d|2[0-3]):[0-5]\d"
          defaultValue={item?.startTime ?? ""}
          className="w-28 tabular-nums"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Duration (min)</Label>
        <Input
          name="durationMinutes"
          type="number"
          min={1}
          defaultValue={item?.durationMinutes ?? ""}
          className="w-28"
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>Item</Label>
        <Input
          name="title"
          required
          placeholder="Doors open / Opener / Changeover / Headliner / Curfew"
          defaultValue={item?.title ?? ""}
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>Note</Label>
        <textarea
          name="note"
          rows={2}
          defaultValue={item?.note ?? ""}
          placeholder="Cues, contacts, technical notes…"
          className="border-input rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
        />
      </div>
    </div>
  );
}

function EditItemDialog({ eventId, item }: { eventId: string; item: RosItem }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`Edit ${item.title}`}
            className="text-muted-foreground transition-colors hover:text-foreground print:hidden"
          >
            <Pencil className="size-3.5" />
          </button>
        }
      />
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <form
          action={async (formData) => {
            await rosUpdateAction(formData);
            setOpen(false);
          }}
          className="flex flex-col"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="itemId" value={item.id} />
          <div className="flex flex-col gap-4 px-6 pb-4 pt-6">
            <DialogTitle className="text-xs font-semibold text-muted-foreground">
              Edit rundown item
            </DialogTitle>
            <ItemFields item={item} />
          </div>
          <div className="flex items-center justify-end gap-3 border-t bg-muted/30 px-6 py-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RosEditor({
  eventId,
  items,
  canManage,
}: {
  eventId: string;
  items: RosItem[];
  canManage: boolean;
}) {
  const [state, formAction, pending] = useActionState<RosActionState, FormData>(
    rosAddAction,
    {},
  );
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-x-auto rounded-card bg-card shadow-card print:rounded-none print:border-0 print:bg-transparent">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="w-20 px-4 py-2.5 font-medium">Time</th>
              <th className="w-20 px-4 py-2.5 font-medium">Dur.</th>
              <th className="px-4 py-2.5 font-medium">Item</th>
              <th className="px-4 py-2.5 font-medium">Note</th>
              {canManage ? <th className="w-16 px-4 py-2.5 print:hidden" /> : null}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={canManage ? 5 : 4}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  No rundown yet{canManage ? " — add the first item below." : "."}
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-b align-top last:border-0">
                  <td className="px-4 py-2.5 font-mono text-sm font-semibold tabular-nums">
                    {item.startTime}
                  </td>
                  <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                    {item.durationMinutes ? `${item.durationMinutes}m` : "—"}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{item.title}</td>
                  <td className="whitespace-pre-wrap px-4 py-2.5 text-xs text-muted-foreground">
                    {item.note}
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2.5 print:hidden">
                      <div className="flex items-center gap-2">
                        <EditItemDialog eventId={eventId} item={item} />
                        <form action={rosDeleteAction}>
                          <input type="hidden" name="eventId" value={eventId} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <button
                            type="submit"
                            aria-label={`Delete ${item.title}`}
                            className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                          >
                            ×
                          </button>
                        </form>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canManage ? (
        !adding ? (
          <div className="print:hidden">
            <Button variant="outline" onClick={() => setAdding(true)}>
              Add rundown item ↗
            </Button>
          </div>
        ) : (
          <form
            action={formAction}
            className={cn(
              "flex flex-col gap-4 rounded-card bg-card shadow-card p-4 print:hidden",
            )}
          >
            <input type="hidden" name="eventId" value={eventId} />
            <ItemFields />
            {state.error ? (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            ) : null}
            <div className="flex gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? "Adding…" : "Add item"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Close
              </Button>
            </div>
          </form>
        )
      ) : null}
    </div>
  );
}
