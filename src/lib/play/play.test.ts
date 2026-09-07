import { describe, expect, it } from "vitest";
import { can, type Actor } from "@/lib/permissions";
import { initialsOf } from "./util";

const owner: Actor = { id: "o", role: "owner", memberships: [] };
const staff: Actor = { id: "s", role: "member", memberships: [{ divisionId: "production", role: "staff" }] };
const noDivision: Actor = { id: "n", role: "member", memberships: [] };
const external: Actor = { id: "x", role: "external", memberships: [] };

describe("play.view capability (T-240)", () => {
  it("opens for every internal user, never for externals", () => {
    expect(can(owner, "play.view")).toBe(true);
    expect(can(staff, "play.view")).toBe(true);
    expect(can(noDivision, "play.view")).toBe(true);
    expect(can(external, "play.view")).toBe(false);
  });
});

describe("initialsOf", () => {
  it("takes first + last initials, or two letters of a single name", () => {
    expect(initialsOf("Ilham Wibowo")).toBe("IW");
    expect(initialsOf("Bara")).toBe("BA");
    expect(initialsOf("  Ada Lovelace King ")).toBe("AK");
    expect(initialsOf("")).toBe("?");
  });
});
