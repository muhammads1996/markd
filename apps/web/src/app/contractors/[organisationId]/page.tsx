import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OperatorChrome } from "../../../components/operator/OperatorChrome";
import {
  assertQuerySuccess,
  getOperatorClient,
  provenanceLabel,
} from "../../../features/work-graph/queries";
import styles from "../../../components/operator/operator-record.module.css";

export default async function ContractorDetailPage({
  params,
}: {
  params: Promise<{ organisationId: string }>;
}) {
  const supabase = await getOperatorClient();
  if (!supabase) redirect("/sign-in?reason=not-authorised");
  const { organisationId } = await params;
  const [
    organisationResult,
    relationshipsResult,
    workmarksResult,
    sitesResult,
  ] = await Promise.all([
    supabase
      .from("organisations")
      .select("id, display_name, legal_name")
      .eq("id", organisationId)
      .is("archived_at", null)
      .maybeSingle(),
    supabase
      .from("worker_organisation_relationships")
      .select("*")
      .eq("organisation_id", organisationId)
      .order("last_worked_on", { ascending: false }),
    supabase
      .from("workmarks")
      .select(
        "id, assignment_id, worker_id, work_started_on, work_ended_on, origin, lifecycle, attendance, completion, payment",
      )
      .eq("organisation_id", organisationId)
      .is("archived_at", null)
      .order("work_started_on", { ascending: false })
      .limit(30),
    supabase
      .from("sites")
      .select("id, name, locality")
      .eq("organisation_id", organisationId)
      .is("archived_at", null),
  ]);
  assertQuerySuccess(organisationResult.error, "loading this contractor");
  assertQuerySuccess(relationshipsResult.error, "loading the labour network");
  assertQuerySuccess(workmarksResult.error, "loading work history");
  assertQuerySuccess(sitesResult.error, "loading sites");
  const organisation = organisationResult.data;
  if (!organisation) notFound();
  const relationships = relationshipsResult.data ?? [];
  const workmarks = workmarksResult.data ?? [];
  const workerIds = [
    ...new Set(
      [
        ...relationships.map((row) => row.worker_id),
        ...workmarks.map((row) => row.worker_id),
      ].filter(Boolean),
    ),
  ];
  const workersResult = workerIds.length
    ? await supabase
        .from("operator_work_cards")
        .select(
          "worker_id, display_name, preferred_name, confirmed_workmark_count",
        )
        .in("worker_id", workerIds)
    : { data: [], error: null };
  assertQuerySuccess(workersResult.error ?? null, "loading worker records");
  const workers = new Map(
    (workersResult.data ?? []).map((row) => [row.worker_id, row]),
  );

  return (
    <OperatorChrome>
      <main className={styles.page}>
        <nav aria-label="Contractor record actions" className={styles.actions}>
          <Link className={styles.back} href="/search">
            ← Search
          </Link>
          <Link href={`/operator/onboard?organisationId=${organisationId}`}>
            Edit contractor
          </Link>
        </nav>
        <header className={styles.header}>
          <p>Contractor record</p>
          <h1>{organisation.display_name}</h1>
          <span>{organisation.legal_name}</span>
        </header>
        <section>
          <h2>Known labour network</h2>
          {relationships.length === 0 ? (
            <p className={styles.empty}>
              No workers have been linked to this contractor yet.
            </p>
          ) : (
            <ul className={styles.cards}>
              {relationships.map((relationship) => {
                const worker = workers.get(relationship.worker_id);
                return (
                  <li key={relationship.worker_id}>
                    <Link href={`/workers/${relationship.worker_id}`}>
                      {worker?.preferred_name ||
                        worker?.display_name ||
                        "Worker record"}
                    </Link>
                    <span>
                      {relationship.confirmed_workmark_count ?? 0} confirmed
                      Workmarks
                      {relationship.is_repeat_relationship
                        ? " · repeated relationship"
                        : ""}
                    </span>
                    <small>
                      First worked{" "}
                      {relationship.first_worked_on ?? "not recorded"} · last
                      worked {relationship.last_worked_on ?? "not recorded"}
                    </small>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section>
          <h2>Recent work history</h2>
          {workmarks.length === 0 ? (
            <p className={styles.empty}>No Workmarks have been recorded yet.</p>
          ) : (
            <ol className={styles.timeline}>
              {workmarks.map((workmark) => {
                const worker = workers.get(workmark.worker_id);
                return (
                  <li key={workmark.id}>
                    <Link href={`/workers/${workmark.worker_id}`}>
                      {worker?.preferred_name ||
                        worker?.display_name ||
                        "Worker record"}
                    </Link>
                    <span>
                      {workmark.work_started_on} to {workmark.work_ended_on}
                    </span>
                    <em
                      data-provenance={
                        workmark.assignment_id
                          ? "markd_arranged"
                          : workmark.origin
                      }
                    >
                      {provenanceLabel(workmark.origin, workmark.assignment_id)}
                    </em>
                    <small>
                      {workmark.attendance} attendance · {workmark.completion}{" "}
                      completion · {workmark.payment} payment
                    </small>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        <section>
          <h2>Known sites</h2>
          {(sitesResult.data ?? []).length === 0 ? (
            <p className={styles.empty}>No sites have been recorded yet.</p>
          ) : (
            <ul className={styles.cards}>
              {(sitesResult.data ?? []).map((site) => (
                <li key={site.id}>
                  <strong>{site.name}</strong>
                  <span>
                    {site.locality
                      ? `Area: ${site.locality}`
                      : "Area not recorded"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </OperatorChrome>
  );
}
