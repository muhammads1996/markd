import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OperatorChrome } from "../../../components/operator/OperatorChrome";
import {
  assertQuerySuccess,
  getOperatorClient,
  provenanceLabel,
} from "../../../features/work-graph/queries";
import styles from "../../../components/operator/operator-record.module.css";
import { TomorrowOfferAction } from "./TomorrowOfferAction";

export default async function WorkerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workerId: string }>;
  searchParams: Promise<{
    labourRequestId?: string;
    requirementId?: string;
    date?: string;
  }>;
}) {
  const supabase = await getOperatorClient();
  if (!supabase) redirect("/sign-in?reason=not-authorised");
  const { workerId } = await params;
  const offerParams = await searchParams;
  const [
    cardResult,
    workmarksResult,
    evidenceResult,
    relationshipsResult,
    crewResult,
  ] = await Promise.all([
    supabase
      .from("operator_work_cards")
      .select("*")
      .eq("worker_id", workerId)
      .maybeSingle(),
    supabase
      .from("workmarks")
      .select(
        "id, assignment_id, work_started_on, work_ended_on, origin, lifecycle, attendance, completion, payment, organisation_id, site_id",
      )
      .eq("worker_id", workerId)
      .is("archived_at", null)
      .order("work_started_on", { ascending: false }),
    supabase
      .from("worker_skill_evidence")
      .select("id, skill_id, source, confidence, created_at")
      .eq("worker_id", workerId)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("worker_organisation_relationships")
      .select("*")
      .eq("worker_id", workerId),
    supabase
      .from("worker_crew_relationships")
      .select("worker_a_id, worker_b_id, created_at")
      .or(`worker_a_id.eq.${workerId},worker_b_id.eq.${workerId}`),
  ]);
  assertQuerySuccess(cardResult.error, "loading this worker");
  assertQuerySuccess(workmarksResult.error, "loading work history");
  assertQuerySuccess(evidenceResult.error, "loading skill evidence");
  assertQuerySuccess(
    relationshipsResult.error,
    "loading contractor relationships",
  );
  assertQuerySuccess(crewResult.error, "loading crew links");
  const card = cardResult.data;
  if (!card) notFound();
  const workmarks = workmarksResult.data ?? [];
  const evidence = evidenceResult.data ?? [];
  const relationships = relationshipsResult.data ?? [];
  const crew = crewResult.data ?? [];
  const organisationIds = [
    ...new Set(
      [...workmarks, ...relationships]
        .map((row) => row.organisation_id)
        .filter(Boolean),
    ),
  ];
  const confirmedWorkmarkIds = workmarks
    .filter((workmark) => workmark.lifecycle === "confirmed")
    .map((workmark) => workmark.id);
  const demonstratedResult = confirmedWorkmarkIds.length
    ? await supabase
        .from("workmark_skills")
        .select("workmark_id, skill_id")
        .in("workmark_id", confirmedWorkmarkIds)
    : { data: [], error: null };
  assertQuerySuccess(
    demonstratedResult.error ?? null,
    "loading demonstrated skills",
  );
  const demonstrated = demonstratedResult.data ?? [];
  const skillIds = [
    ...new Set([
      ...evidence.map((row) => row.skill_id),
      ...demonstrated.map((row) => row.skill_id),
    ]),
  ];
  const crewIds = crew
    .map((link) =>
      link.worker_a_id === workerId ? link.worker_b_id : link.worker_a_id,
    )
    .filter(Boolean);
  const [organisationsResult, skillsResult, crewCardsResult] =
    await Promise.all([
      organisationIds.length
        ? supabase
            .from("organisations")
            .select("id, display_name")
            .in("id", organisationIds)
        : { data: [], error: null },
      skillIds.length
        ? supabase.from("skills").select("id, name").in("id", skillIds)
        : { data: [], error: null },
      crewIds.length
        ? supabase
            .from("operator_work_cards")
            .select("worker_id, display_name, preferred_name")
            .in("worker_id", crewIds)
        : { data: [], error: null },
    ]);
  assertQuerySuccess(organisationsResult.error ?? null, "loading contractors");
  assertQuerySuccess(skillsResult.error ?? null, "loading skills");
  assertQuerySuccess(crewCardsResult.error ?? null, "loading crew records");
  const organisations = new Map(
    (organisationsResult.data ?? []).map((row) => [row.id, row.display_name]),
  );
  const skills = new Map(
    (skillsResult.data ?? []).map((row) => [row.id, row.name]),
  );
  const crewCards = new Map(
    (crewCardsResult.data ?? []).map((row) => [row.worker_id, row]),
  );
  let offerTarget: {
    requestId: string;
    requirementId: string;
    workType: string;
    siteArea: string | null;
    date: string;
  } | null = null;
  if (offerParams.labourRequestId && offerParams.requirementId) {
    const [requestResult, requirementResult] = await Promise.all([
      supabase
        .from("labour_requests")
        .select("id, lifecycle, needed_from, needed_to, site_area")
        .eq("id", offerParams.labourRequestId)
        .maybeSingle(),
      supabase
        .from("labour_requirements")
        .select("id, labour_request_id, work_type")
        .eq("id", offerParams.requirementId)
        .is("archived_at", null)
        .maybeSingle(),
    ]);
    assertQuerySuccess(
      requestResult.error,
      "loading the selected Labour Request",
    );
    assertQuerySuccess(
      requirementResult.error,
      "loading the selected requirement",
    );
    const targetRequest = requestResult.data;
    const targetRequirement = requirementResult.data;
    if (
      targetRequest?.lifecycle === "active" &&
      targetRequirement &&
      targetRequirement.labour_request_id === targetRequest.id
    ) {
      const requestedDate = offerParams.date;
      offerTarget = {
        requestId: targetRequest.id,
        requirementId: targetRequirement.id,
        workType: targetRequirement.work_type,
        siteArea: targetRequest.site_area,
        date:
          requestedDate &&
          requestedDate >= targetRequest.needed_from &&
          requestedDate <= targetRequest.needed_to
            ? requestedDate
            : targetRequest.needed_from,
      };
    }
  }

  return (
    <OperatorChrome>
      <main className={styles.page}>
        <nav aria-label="Worker record actions" className={styles.actions}>
          <Link className={styles.back} href="/search">
            ← Search
          </Link>
          <Link href={`/operator/onboard?workerId=${workerId}`}>
            Edit worker
          </Link>
        </nav>
        <header className={styles.header}>
          <p>Worker record</p>
          <h1>{card.preferred_name || card.display_name}</h1>
          <span>{card.confirmed_workmark_count ?? 0} confirmed Workmarks</span>
        </header>
        {offerTarget ? (
          <section aria-label="Tomorrow offer" className={styles.offerPanel}>
            <h2>Offer for {offerTarget.date}</h2>
            <p>
              {offerTarget.workType} ·{" "}
              {offerTarget.siteArea ?? "Site to confirm"}
            </p>
            <TomorrowOfferAction
              workerId={workerId}
              workerName={card.preferred_name || card.display_name}
              target={offerTarget}
            />
          </section>
        ) : null}
        <section>
          <h2>Work history</h2>
          {workmarks.length === 0 ? (
            <p className={styles.empty}>No Workmarks have been recorded yet.</p>
          ) : (
            <ol className={styles.timeline}>
              {workmarks.map((workmark) => (
                <li key={workmark.id}>
                  <strong>
                    {organisations.get(workmark.organisation_id) ??
                      "Organisation record"}
                  </strong>
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
              ))}
            </ol>
          )}
        </section>
        <section>
          <h2>Demonstrated skills</h2>
          {demonstrated.length === 0 ? (
            <p className={styles.empty}>
              No skills have been demonstrated through confirmed Workmarks yet.
            </p>
          ) : (
            <ul className={styles.list}>
              {[
                ...new Set(
                  demonstrated.map((item) => skills.get(item.skill_id)),
                ),
              ].map((skill) => (
                <li key={skill ?? "unknown-skill"}>
                  <strong>{skill ?? "Skill"}</strong>
                  <span>Confirmed Workmark evidence from work history</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>Recorded skill evidence</h2>
          {evidence.length === 0 ? (
            <p className={styles.empty}>
              No skill evidence has been recorded yet.
            </p>
          ) : (
            <ul className={styles.list}>
              {evidence.map((item) => (
                <li key={item.id}>
                  <strong>{skills.get(item.skill_id) ?? "Skill"}</strong>
                  <span>
                    Evidence source: {item.source}
                    {item.confidence !== null
                      ? ` · confidence ${item.confidence}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>Contractor relationships</h2>
          {relationships.length === 0 ? (
            <p className={styles.empty}>
              No contractor relationships have been recorded yet.
            </p>
          ) : (
            <ul className={styles.list}>
              {relationships.map((relationship) => (
                <li key={relationship.organisation_id}>
                  <strong>
                    {organisations.get(relationship.organisation_id) ??
                      "Organisation record"}
                  </strong>
                  <span>
                    {relationship.confirmed_workmark_count ?? 0} confirmed
                    Workmarks
                    {relationship.is_repeat_relationship
                      ? " · repeated relationship"
                      : ""}{" "}
                    · last worked{" "}
                    {relationship.last_worked_on ?? "not recorded"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>Crew links</h2>
          {crewIds.length === 0 ? (
            <p className={styles.empty}>
              No crew links have been recorded yet.
            </p>
          ) : (
            <ul className={styles.list}>
              {crewIds.map((crewId) => {
                const crewCard = crewCards.get(crewId);
                return (
                  <li key={crewId}>
                    <Link href={`/workers/${crewId}`}>
                      {crewCard?.preferred_name ||
                        crewCard?.display_name ||
                        "Worker record"}
                    </Link>
                    <span>Known crew connection</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </OperatorChrome>
  );
}
