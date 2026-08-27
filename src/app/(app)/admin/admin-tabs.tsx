"use client";

import { Crown, KeyRound, Mail, ShieldCheck, Star, User } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { ChipMultiSelect, UserSingleSelect } from "@/components/choice-chips";
import { Segmented } from "@/components/segmented";
import { UserAvatar } from "@/components/task-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  assignMembershipAction,
  createUserAction,
  removeMembershipAction,
  resetUserPasswordAction,
  setUserContactAction,
  toggleActiveAction,
  type ActionState,
} from "./actions";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  phone: string | null;
  whatsappNotifications: boolean;
  memberships: Array<{ divisionId: string; role: string }>;
}

export interface AdminDivision {
  id: string;
  name: string;
}

const TABS = [
  { key: "users", label: "Users" },
  { key: "create", label: "Create user" },
  { key: "assign", label: "Assign divisions" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const GLOBAL_ROLE_OPTIONS = [
  { value: "member", label: "Member", icon: <User className="size-3.5" /> },
  { value: "admin", label: "Admin", icon: <ShieldCheck className="size-3.5" /> },
  { value: "owner", label: "Owner", icon: <Crown className="size-3.5" /> },
  {
    value: "external",
    label: "External",
    icon: <Mail className="size-3.5" />,
    hint: "Magic link only — no password",
  },
];

const DIVISION_ROLE_OPTIONS = [
  { value: "staff", label: "Staff", icon: <User className="size-3.5" /> },
  { value: "head", label: "Head", icon: <Star className="size-3.5" /> },
];

export function AdminTabs({
  users,
  divisions,
}: {
  users: AdminUser[];
  divisions: AdminDivision[];
}) {
  const [tab, setTab] = useState<TabKey>("users");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" ? (
        <UsersTable users={users} divisions={divisions} />
      ) : null}
      {tab === "create" ? <CreateUserForm divisions={divisions} /> : null}
      {tab === "assign" ? (
        <AssignForm users={users} divisions={divisions} />
      ) : null}
    </div>
  );
}

function ActiveSwitch({ user }: { user: AdminUser }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={toggleActiveAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="isActive" value={String(!user.isActive)} />
      <Switch
        checked={user.isActive}
        onCheckedChange={() => formRef.current?.requestSubmit()}
        aria-label={user.isActive ? "Deactivate account" : "Activate account"}
      />
      <span
        className={cn(
          "text-[10px] font-medium uppercase tracking-widest",
          user.isActive ? "text-status-done" : "text-status-blocked",
        )}
      >
        {user.isActive ? "Active" : "Inactive"}
      </span>
    </form>
  );
}

/**
 * Phone + WhatsApp switch, editable by an admin. Without this a number could
 * only be set by each person in their own Settings, which left the gateway
 * with no recipients at all.
 */
function ContactCell({ user }: { user: AdminUser }) {
  const [phone, setPhone] = useState(user.phone ?? "");
  const [wa, setWa] = useState(user.whatsappNotifications);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    setUserContactAction,
    {},
  );
  const dirty = phone.trim() !== (user.phone ?? "") || wa !== user.whatsappNotifications;

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="userId" value={user.id} />
      {wa ? <input type="hidden" name="whatsapp" value="on" /> : null}
      <div className="flex items-center gap-2">
        <Input
          name="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="08123456789"
          inputMode="tel"
          aria-label={`Phone number for ${user.name}`}
          className="h-8 w-36 text-xs"
        />
        <Switch
          checked={wa}
          onCheckedChange={setWa}
          disabled={!phone.trim()}
          aria-label={`WhatsApp notifications for ${user.name}`}
        />
      </div>
      {state.error ? (
        <span role="alert" className="text-[10px] text-destructive">
          {state.error}
        </span>
      ) : null}
      {dirty ? (
        <Button type="submit" size="sm" disabled={pending} className="h-7 self-start text-xs">
          {pending ? "Saving…" : "Save"}
        </Button>
      ) : user.phone && user.whatsappNotifications ? (
        <span className="text-[10px] text-status-done">WhatsApp on</span>
      ) : (
        <span className="text-[10px] text-muted-foreground">
          {user.phone ? "Number set, WhatsApp off" : "No number — WhatsApp can't reach them"}
        </span>
      )}
    </form>
  );
}

/**
 * Admin password reset. Collapsed until asked for, because it is a takeover
 * button sitting in a table of everyday switches — it should take a deliberate
 * click to open, not sit there invitingly next to the WhatsApp toggle.
 *
 * External guests have no password at all (magic link), so they get a note
 * instead of a form rather than an error after the fact.
 */
function PasswordCell({ user }: { user: AdminUser }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    resetUserPasswordAction,
    {},
  );

  if (user.role === "external") {
    return (
      <span className="text-[10px] text-muted-foreground">Magic link — no password</span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        <KeyRound className="size-3" /> Reset
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="userId" value={user.id} />
      <Input
        name="password"
        type="password"
        minLength={8}
        required
        autoFocus
        placeholder="New password"
        aria-label={`New password for ${user.name}`}
        className="h-8 w-40 text-xs"
      />
      <Input
        name="confirm"
        type="password"
        minLength={8}
        required
        placeholder="Repeat it"
        aria-label={`Repeat the new password for ${user.name}`}
        className="h-8 w-40 text-xs"
      />
      <div className="flex items-center gap-1.5">
        <Button type="submit" size="sm" disabled={pending} className="h-7 text-xs">
          {pending ? "Saving…" : "Set"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      {state.error ? (
        <span role="alert" className="text-[10px] text-destructive">
          {state.error}
        </span>
      ) : null}
      {state.ok ? (
        <span className="text-[10px] text-status-done">
          Password changed — tell {user.name} directly, it is not emailed.
        </span>
      ) : null}
    </form>
  );
}

function UsersTable({
  users,
  divisions,
}: {
  users: AdminUser[];
  divisions: AdminDivision[];
}) {
  const divisionName = new Map(divisions.map((d) => [d.id, d.name]));

  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 font-medium">User</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Divisions</th>
            <th className="px-4 py-3 font-medium">WhatsApp</th>
            <th className="px-4 py-3 font-medium">Password</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr
              key={user.id}
              className={cn(
                "border-b transition-colors last:border-0 hover:bg-accent/30",
                !user.isActive && "opacity-50",
              )}
            >
              <td className="px-4 py-3">
                <span className="flex items-center gap-2.5">
                  <UserAvatar name={user.name} className="size-7 text-[10px]" />
                  <span className="flex flex-col">
                    <span className="font-medium">{user.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </span>
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {user.role === "owner" ? <Crown className="size-3" /> : null}
                  {user.role === "admin" ? <ShieldCheck className="size-3" /> : null}
                  {user.role === "external" ? <Mail className="size-3" /> : null}
                  {user.role}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {user.memberships.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    user.memberships.map((m) => (
                      <form action={removeMembershipAction} key={m.divisionId}>
                        <input type="hidden" name="userId" value={user.id} />
                        <input
                          type="hidden"
                          name="divisionId"
                          value={m.divisionId}
                        />
                        <button
                          type="submit"
                          title="Remove from division"
                          className={cn(
                            "group/chip inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all duration-150",
                            "hover:border-destructive/60 hover:bg-destructive/10 active:scale-[0.97]",
                            m.role === "head" && "font-semibold",
                          )}
                        >
                          {m.role === "head" ? (
                            <Star className="size-3 text-priority-high" />
                          ) : (
                            <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                          )}
                          {divisionName.get(m.divisionId) ?? m.divisionId}
                          <span className="text-muted-foreground transition-colors group-hover/chip:text-destructive">
                            ×
                          </span>
                        </button>
                      </form>
                    ))
                  )}
                </div>
              </td>
              <td className="px-4 py-3 align-top">
                <ContactCell user={user} />
              </td>
              <td className="px-4 py-3 align-top">
                <PasswordCell user={user} />
              </td>
              <td className="px-4 py-3">
                <ActiveSwitch user={user} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateUserForm({ divisions }: { divisions: AdminDivision[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createUserAction,
    {},
  );

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-name">Name</Label>
          <Input id="new-name" name="name" required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-email">Email</Label>
          <Input id="new-email" name="email" type="email" required />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label>Global role</Label>
        <Segmented name="role" options={GLOBAL_ROLE_OPTIONS} defaultValue="member" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-password">Password (internal roles)</Label>
          <Input id="new-password" name="password" type="password" minLength={8} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-phone">Phone — optional</Label>
          <Input id="new-phone" name="phone" placeholder="08123456789" inputMode="tel" />
          <span className="text-[11px] text-muted-foreground">
            Setting a number switches WhatsApp notifications on for them.
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <Label>Divisions — optional, pick several</Label>
        <ChipMultiSelect
          name="divisionIds"
          options={divisions.map((d) => ({ value: d.id, label: d.name }))}
        />
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-muted-foreground">join as</span>
          <Segmented
            name="divisionRole"
            options={DIVISION_ROLE_OPTIONS}
            defaultValue="staff"
          />
        </div>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state.ok ? (
        <p className="text-sm text-status-done">User created.</p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create user"}
        </Button>
      </div>
    </form>
  );
}

function AssignForm({
  users,
  divisions,
}: {
  users: AdminUser[];
  divisions: AdminDivision[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    assignMembershipAction,
    {},
  );

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <Label>User</Label>
        <UserSingleSelect
          name="userId"
          users={users
            .filter((u) => u.role !== "external")
            .map((u) => ({ id: u.id, name: u.name }))}
        />
      </div>
      <div className="flex flex-col gap-2.5">
        <Label>Divisions — pick one or several</Label>
        <ChipMultiSelect
          name="divisionIds"
          options={divisions.map((d) => ({ value: d.id, label: d.name }))}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Join as</Label>
        <Segmented name="role" options={DIVISION_ROLE_OPTIONS} defaultValue="staff" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state.ok ? (
        <p className="text-sm text-status-done">Memberships saved.</p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Assign"}
        </Button>
      </div>
    </form>
  );
}
