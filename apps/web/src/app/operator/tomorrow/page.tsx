import Link from "next/link";
import { redirect } from "next/navigation";

import { OperatorChrome } from "../../../components/operator/OperatorChrome";
import {
  loadTomorrow,
  type TomorrowAssignment,
} from "../../../features/tomorrow/queries";
import { getOperatorClient } from "../../../features/work-graph/queries";
import { TomorrowActions } from "./TomorrowActions";
import styles from "./tomorrow.module.css";

type Props = { searchParams: Promise<{ date?: string }> };

function assignmentState(assignment: TomorrowAssignment) {
  if (assignment.bucket === "travel_ready") return "TRAVEL READY";
  if (assignment.bucket === "accepted_waiting")
    return "ACCEPTED · DO NOT TRAVEL";
  if (assignment.bucket === "awaiting_worker_response")
    return "OFFER SENT · WAITING";
  if (assignment.bucket === "cancelled") return "CANCELLED";
  return "ASSIGNMENT ACTIVE";
}

function money(cents: number | null, currency: string | null) {
  return cents === null
    ? null
    : `${currency ?? "ZAR"} ${(cents / 100).toFixed(2)}`;
}

export default async function TomorrowPage({ searchParams }: Props) {
  if (!(await getOperatorClient())) redirect("/sign-in?reason=not-authorised");
  const date = (await searchParams).date;
  let board;
  try {
    board = await loadTomorrow(date);
  } catch {
    return (
      <OperatorChrome>
        <main className={styles.shell}>
          <p className={styles.error}>
            Tomorrow could not be loaded. Refresh or check the operator API.
          </p>
        </main>
      </OperatorChrome>
    );
  }
  const summary = board.summary;
  const dateLabel = board.date ?? "Tomorrow";
  const fullyCovered =
    summary.positions_required > 0 &&
    summary.positions_required === summary.travel_ready &&
    !summary.open_exceptions &&
    !summary.communication_failures &&
    !summary.review_required;
  return (
    <OperatorChrome>
      <main className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Operations command centre</p>
            <h1>Tomorrow</h1>
            <p>{dateLabel}</p>
          </div>
          <a
            className={styles.refresh}
            href={
              date
                ? `/operator/tomorrow?date=${encodeURIComponent(date)}`
                : "/operator/tomorrow"
            }
          >
            Refresh
          </a>
        </header>
        {board.requests.length === 0 ? (
          <section className={styles.empty}>
            <strong>Nothing scheduled for tomorrow.</strong>
            <span>No operational tasks have been created.</span>
          </section>
        ) : (
          <>
            <section
              className={styles.summary}
              aria-label="Tomorrow operational summary"
            >
              <div>
                <strong>{summary.labour_requests}</strong>
                <span>labour requests</span>
              </div>
              <div>
                <strong>{summary.positions_required}</strong>
                <span>positions required</span>
              </div>
              <div>
                <strong>{summary.travel_ready}</strong>
                <span>travel ready</span>
              </div>
              <div>
                <strong>{summary.waiting_worker_response}</strong>
                <span>waiting worker</span>
              </div>
              <div>
                <strong>{summary.waiting_hirer_confirmation}</strong>
                <span>waiting hirer</span>
              </div>
              <div>
                <strong>{summary.logistics_gap}</strong>
                <span>logistics gaps</span>
              </div>
              <div>
                <strong>{summary.open_exceptions}</strong>
                <span>exceptions</span>
              </div>
            </section>
            {fullyCovered ? (
              <section className={styles.covered}>
                <strong>Tomorrow is covered.</strong>
                <span>
                  {summary.travel_ready} / {summary.positions_required}{" "}
                  positions travel ready. No unresolved operational blockers.
                </span>
              </section>
            ) : null}
            <section
              className={styles.list}
              aria-label="Tomorrow labour requests"
            >
              {board.requests.map((request) => (
                <article
                  className={styles.request}
                  key={request.labour_request_id}
                >
                  <header>
                    <div>
                      <p className={styles.eyebrow}>
                        {request.site_area ?? "Site to confirm"}
                      </p>
                      <h2>{request.hirer_name}</h2>
                      <p>
                        {request.site_text ?? ""}{" "}
                        {request.needed_at ? `· ${request.needed_at}` : ""}
                      </p>
                    </div>
                    <Link href="/search">Find workers</Link>
                  </header>
                  <div className={styles.requirements}>
                    {request.requirements.map((requirement) => (
                      <div key={requirement.id}>
                        <strong>{requirement.work_type}</strong>
                        <span>
                          {requirement.covered_headcount} covered /{" "}
                          {requirement.required_headcount} required
                        </span>
                        {requirement.remaining_gap > 0 ? (
                          <b>{requirement.remaining_gap} open</b>
                        ) : (
                          <b>Covered</b>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className={styles.assignments}>
                    {request.assignments.map((assignment) => (
                      <section
                        className={styles.assignment}
                        data-state={assignment.bucket}
                        key={assignment.id}
                      >
                        <header>
                          <div>
                            <strong>
                              {assignment.worker_name ?? "Worker"}
                            </strong>
                            <span>{assignmentState(assignment)}</span>
                          </div>
                          <Link href="/operator/inbox">Review</Link>
                        </header>
                        {assignment.blockers.length ? (
                          <p className={styles.blockers}>
                            {assignment.blockers.join(" · ")}
                          </p>
                        ) : null}
                        {assignment.travel_ready ? (
                          <p className={styles.ready}>
                            Authorised to travel{" "}
                            {assignment.reporting_mode === "pickup"
                              ? "to pickup"
                              : "to site"}
                            :{" "}
                            {assignment.reporting_place_text ??
                              "Location confirmed"}
                            {assignment.reporting_time
                              ? ` · ${assignment.reporting_time}`
                              : ""}
                          </p>
                        ) : null}
                        {money(request.rate_cents, request.currency) ? (
                          <small>
                            {money(request.rate_cents, request.currency)}{" "}
                            {request.terms ? `· ${request.terms}` : ""}
                          </small>
                        ) : null}
                        {assignment.has_open_exception ? (
                          <Link
                            className={styles.exception}
                            href="/operator/exceptions"
                          >
                            Open operational exception
                          </Link>
                        ) : null}
                        {assignment.failed_deliveries.length ? (
                          <p className={styles.failure}>
                            Communication failed — follow up. Domain assignment
                            state is unchanged.
                          </p>
                        ) : null}
                        {assignment.review_evidence.length ? (
                          <details className={styles.review}>
                            <summary>
                              Review required — semantic evidence is not
                              assignment truth.
                            </summary>
                            {assignment.review_evidence.map((evidence) => (
                              <div key={evidence.id}>
                                <p>
                                  {evidence.original_text ??
                                    "Original participant content unavailable."}
                                </p>
                                <p>
                                  Proposed:{" "}
                                  {JSON.stringify(evidence.interpretation)}
                                </p>
                                <p>
                                  {evidence.provider ?? "Provider unavailable"}{" "}
                                  {evidence.model ?? ""} · confidence{" "}
                                  {evidence.confidence ?? "not scored"}
                                </p>
                                <p>
                                  {evidence.semantic_mode === "shadow"
                                    ? "Shadow evidence — "
                                    : ""}
                                  {evidence.policy_reason ??
                                    "Operator review required."}
                                </p>
                                <Link href="/operator/inbox">
                                  Open canonical review
                                </Link>
                              </div>
                            ))}
                          </details>
                        ) : null}
                        <TomorrowActions
                          assignmentId={assignment.id}
                          blockers={assignment.blockers}
                          bucket={assignment.bucket}
                          contractorConfirmation={
                            assignment.contractor_confirmation
                          }
                          version={assignment.version}
                        />
                      </section>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          </>
        )}
      </main>
    </OperatorChrome>
  );
}
