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
  if (assignment.worker_response === "declined") return "DECLINED - REPLACE";
  if (assignment.contractor_confirmation === "rejected")
    return "HIRER REJECTED - REPLACE";
  if (!assignment.offered_at) return "NOT OFFERED";
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
    summary.positions_required === summary.covered_positions &&
    !summary.waiting_worker_response &&
    !summary.waiting_hirer_confirmation &&
    !summary.logistics_gap &&
    !summary.open_exceptions &&
    !summary.communication_failures &&
    !summary.review_required &&
    !summary.availability_conflicts;
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
            <strong>
              Nothing scheduled for {date ? "this date" : "tomorrow"}.
            </strong>
            <span>No Labour Requests fall on this work date.</span>
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
                <strong>{summary.open_positions}</strong>
                <span>open positions</span>
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
              <div>
                <strong>{summary.communication_failures}</strong>
                <span>message issues</span>
              </div>
              <div>
                <strong>{summary.review_required}</strong>
                <span>review needed</span>
              </div>
              <div>
                <strong>{summary.availability_conflicts}</strong>
                <span>availability conflicts</span>
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
                      {request.lifecycle === "cancelled" ? (
                        <strong>Cancelled - communication follow-up</strong>
                      ) : null}
                      <p>
                        {request.site_text ?? ""}{" "}
                        {request.needed_at ? `· ${request.needed_at}` : ""}
                      </p>
                    </div>
                    {request.lifecycle === "active" ? (
                      <span>Open a gap below to find workers</span>
                    ) : null}
                  </header>
                  {request.lifecycle === "active" ? (
                    <div className={styles.requirements}>
                      {request.requirements.map((requirement) => (
                        <div key={requirement.id}>
                          <strong>{requirement.work_type}</strong>
                          <span>
                            {requirement.covered_headcount} covered /{" "}
                            {requirement.required_headcount} required
                          </span>
                          {requirement.remaining_gap > 0 ? (
                            <b>
                              {requirement.remaining_gap} open{" "}
                              <Link
                                href={`/search?labourRequestId=${request.labour_request_id}&requirementId=${requirement.id}&date=${board.date}`}
                              >
                                Find and offer worker
                              </Link>
                            </b>
                          ) : (
                            <b>Covered</b>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
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
                          <span>
                            {request.requirements.find(
                              (item) =>
                                item.id === assignment.labour_requirement_id,
                            )?.work_type ?? "Work"}
                          </span>
                        </header>
                        {assignment.blockers.length ? (
                          <p className={styles.blockers}>
                            {assignment.blockers.join(" · ")}
                          </p>
                        ) : null}
                        {assignment.reporting_mode ||
                        assignment.reporting_place_text ||
                        assignment.reporting_time ? (
                          <dl className={styles.logistics}>
                            <div>
                              <dt>Reporting mode</dt>
                              <dd>{assignment.reporting_mode ?? "Not set"}</dd>
                            </div>
                            <div>
                              <dt>Location</dt>
                              <dd>
                                {assignment.reporting_place_text ?? "Not set"}
                              </dd>
                            </div>
                            <div>
                              <dt>Local time</dt>
                              <dd>{assignment.reporting_time ?? "Not set"}</dd>
                            </div>
                            {assignment.landmark ? (
                              <div>
                                <dt>Landmark</dt>
                                <dd>{assignment.landmark}</dd>
                              </div>
                            ) : null}
                            {assignment.instructions ? (
                              <div>
                                <dt>Instructions</dt>
                                <dd>{assignment.instructions}</dd>
                              </div>
                            ) : null}
                          </dl>
                        ) : null}
                        {assignment.availability_conflict ? (
                          <p className={styles.failure}>
                            Worker availability is marked unavailable. Verify
                            with the worker; assignment and travel state have
                            not changed.
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
                        {assignment.worker_on_my_way ? (
                          <p className={styles.evidence}>
                            Worker acknowledged: on my way.
                          </p>
                        ) : null}
                        {money(
                          assignment.agreed_rate_cents ?? request.rate_cents,
                          assignment.currency ?? request.currency,
                        ) ? (
                          <small>
                            {money(
                              assignment.agreed_rate_cents ??
                                request.rate_cents,
                              assignment.currency ?? request.currency,
                            )}{" "}
                            {request.terms ? `· ${request.terms}` : ""}
                          </small>
                        ) : null}
                        {assignment.open_exceptions.map((item) => (
                          <Link
                            key={item.id}
                            className={styles.exception}
                            href={`/operator/exceptions#case-${item.id}`}
                          >
                            Open exception: {item.category.replaceAll("_", " ")}
                          </Link>
                        ))}
                        {assignment.failed_deliveries.map((item) => (
                          <p key={item.id} className={styles.failure}>
                            {item.message_kind.replaceAll("_", " ")} WhatsApp{" "}
                            {item.state === "failed"
                              ? "failed"
                              : "is retrying after an error"}
                            . Contact the participant and open Inbox to follow
                            up. Assignment state is unchanged.
                            {item.failure_reason
                              ? ` Reason: ${item.failure_reason}`
                              : ""}{" "}
                            <Link href="/operator/inbox">Open Inbox</Link>
                          </p>
                        ))}
                        {assignment.communication_evidence.length ? (
                          <p className={styles.evidence}>
                            WhatsApp:{" "}
                            {assignment.communication_evidence
                              .map(
                                (item) =>
                                  `${item.message_kind.split(".").at(-1)} ${item.state}`,
                              )
                              .join("; ")}
                            . Delivery is not assignment truth.
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
                                  {evidence.decision_provider ??
                                    evidence.provider ??
                                    "Provider unavailable"}{" "}
                                  {evidence.model_version ??
                                    evidence.model ??
                                    ""}{" "}
                                  · model confidence{" "}
                                  {evidence.confidence ?? "not scored"}
                                </p>
                                <p>
                                  Policy:{" "}
                                  {evidence.policy_outcome ?? "Review required"}
                                  .{" "}
                                  {evidence.semantic_mode === "shadow"
                                    ? "Shadow evidence — "
                                    : ""}
                                  {evidence.policy_reason ??
                                    "Operator review required."}
                                </p>
                                <Link
                                  href={`/operator/inbox#proposed-action-${evidence.id}`}
                                >
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
                          offeredAt={assignment.offered_at}
                          version={assignment.version}
                          timezone={request.timezone}
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
