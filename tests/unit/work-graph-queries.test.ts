import { describe, expect, it } from "vitest";

import {
  mapSearchRows,
  provenanceLabel,
} from "../../apps/web/src/features/work-graph/queries.ts";

describe("Work Graph search row mapping", () => {
  it("deduplicates results and maps each kind to a safe route", () => {
    expect(
      mapSearchRows([
        {
          result_kind: "worker",
          result_id: "w-1",
          title: "Amina",
          detail: "2 Workmarks",
        },
        {
          result_kind: "worker",
          result_id: "w-1",
          title: "Amina",
          detail: "2 Workmarks",
        },
        {
          result_kind: "contractor",
          result_id: "o-1",
          title: "Build Co",
          detail: "Cape Town",
        },
        {
          result_kind: "site",
          result_id: "s-1",
          title: "Site 1",
          detail: "Observatory",
        },
        {
          result_kind: "skill",
          result_id: "sk-1",
          title: "Bricklaying",
          detail: "Demonstrated",
        },
      ]),
    ).toEqual([
      {
        id: "w-1",
        kind: "worker",
        title: "Amina",
        detail: "2 Workmarks",
        href: "/workers/w-1",
      },
      {
        id: "o-1",
        kind: "contractor",
        title: "Build Co",
        detail: "Cape Town",
        href: "/contractors/o-1",
      },
      {
        id: "s-1",
        kind: "site",
        title: "Site 1",
        detail: "Observatory",
        href: "/search?q=Site%201",
      },
      {
        id: "sk-1",
        kind: "skill",
        title: "Bricklaying",
        detail: "Demonstrated",
        href: "/search?q=Bricklaying",
      },
    ]);
  });

  it("rejects malformed policy rows", () => {
    expect(() =>
      mapSearchRows([{ result_kind: "worker", result_id: "w-1" }]),
    ).toThrow();
    expect(() =>
      mapSearchRows([
        {
          result_kind: "phone",
          result_id: "p-1",
          title: "021",
          detail: "phone",
        },
      ]),
    ).toThrow();
  });

  it("does not represent phone numbers in search results", () => {
    const [result] = mapSearchRows([
      {
        result_kind: "worker",
        result_id: "w-1",
        title: "Amina",
        detail: "Matched phone number",
        phone_number: "+27821234567",
      },
    ]);
    expect(result).not.toHaveProperty("phone_number");
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toEqual([
      "id",
      "kind",
      "title",
      "detail",
      "href",
    ]);
  });
});

describe("Workmark provenance labels", () => {
  it("keeps historical claims distinct even if legacy data has an assignment", () => {
    expect(provenanceLabel("historical_claim", "assignment-id")).toBe(
      "Historical claim",
    );
  });

  it("classifies an assigned Workmark as MARKD-arranged", () => {
    expect(provenanceLabel("operator_entry", "assignment-id")).toBe(
      "MARKD-arranged work",
    );
  });

  it("keeps unassigned channel reports distinct", () => {
    expect(provenanceLabel("channel_event", null)).toBe(
      "Channel-reported work",
    );
  });
});
