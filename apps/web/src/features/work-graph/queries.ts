import { createSupabaseServerClient } from "../../lib/supabase/server";

export type SearchResult = {
  id: string;
  kind: "worker" | "contractor" | "site" | "skill";
  title: string;
  detail: string;
  href: string;
};

export async function getOperatorClient() {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (!userData.user) return null;
  assertQuerySuccess(userError, "checking the current session");
  const { data: operator, error: operatorError } = await supabase
    .from("operator_accounts")
    .select("role")
    .is("archived_at", null)
    .maybeSingle();
  assertQuerySuccess(operatorError, "checking operator access");
  return operator ? supabase : null;
}

export function assertQuerySuccess(
  error: { message: string } | null,
  context: string,
) {
  if (error) {
    throw new Error(`Unable to load the Work Graph while ${context}.`);
  }
}

type SearchRpcRow = {
  result_kind: "worker" | "contractor" | "site" | "skill";
  result_id: string;
  title: string;
  detail: string;
};

function isSearchKind(value: unknown): value is SearchRpcRow["result_kind"] {
  return (
    value === "worker" ||
    value === "contractor" ||
    value === "site" ||
    value === "skill"
  );
}

/** Maps the policy RPC's deliberately small public search shape to UI links. */
export function mapSearchRows(rows: unknown): SearchResult[] {
  if (!Array.isArray(rows)) {
    throw new Error(
      "Unable to load the Work Graph while mapping search results.",
    );
  }

  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      throw new Error(
        "Unable to load the Work Graph while mapping search results.",
      );
    }

    const candidate = row as Record<string, unknown>;
    const kind = candidate.result_kind;
    const id = candidate.result_id;
    const title = candidate.title;
    const detail = candidate.detail;
    if (
      !isSearchKind(kind) ||
      typeof id !== "string" ||
      !id.trim() ||
      typeof title !== "string" ||
      !title.trim() ||
      typeof detail !== "string"
    ) {
      throw new Error(
        "Unable to load the Work Graph while mapping search results.",
      );
    }

    const dedupeKey = `${kind}:${id}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const encodedTitle = encodeURIComponent(title);
    const href =
      kind === "worker"
        ? `/workers/${id}`
        : kind === "contractor"
          ? `/contractors/${id}`
          : `/search?q=${encodedTitle}`;

    results.push({ id, kind, title, detail, href });
  }
  return results;
}

export async function searchWorkGraph(query: string): Promise<SearchResult[]> {
  const supabase = await getOperatorClient();
  if (!supabase || !query.trim()) return [];
  const { data, error } = await supabase.rpc("search_work_graph", {
    search_term: query.trim(),
    max_results: 40,
  });
  assertQuerySuccess(error, "searching the Work Graph");
  return mapSearchRows(data);
}

export function provenanceLabel(origin: string, assignmentId: string | null) {
  if (origin === "historical_claim") return "Historical claim";
  if (assignmentId) return "MARKD-arranged work";
  if (origin === "channel_event") return "Channel-reported work";
  return "Operator-recorded work";
}
