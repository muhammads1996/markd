"use client";

import { useActionState, useState } from "react";

import type { AssignmentOption } from "../../../features/exceptions/queries";
import { openException, type ExceptionActionState } from "./actions";
import styles from "./exceptions.module.css";

export function OpenExceptionForm({ assignments, submissionNonce }: { assignments: AssignmentOption[]; submissionNonce: string }) {
  const [state, action, pending] = useActionState<ExceptionActionState, FormData>(openException, {});
  const [assignmentId, setAssignmentId] = useState("");
  const assignment = assignments.find((item) => item.id === assignmentId);
  return (
    <details className={styles.capture}>
      <summary>Open an exception</summary>
      <form action={action} className={styles.form}>
        <input name="submissionNonce" type="hidden" value={submissionNonce} />
        <label>Assignment
          <select name="assignmentId" required value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>
            <option value="" disabled>Choose a worker, hirer and date</option>
            {assignments.map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.label}</option>)}
          </select>
        </label>
        <label>Exception type
          <select name="type" required defaultValue="verification_trust_concern"><option value="payment_dispute">Payment dispute</option><option value="attendance_dispute">Attendance dispute</option><option value="completion_dispute">Completion dispute</option><option value="no_show_concern">No-show concern</option><option value="cancelled_after_commitment">Cancelled after commitment</option><option value="cancelled_after_travel_authorisation">Cancelled after travel authorisation</option><option value="ambiguous_completion">Ambiguous completion</option><option value="verification_trust_concern">Verification / trust concern</option></select>
        </label>
        <label>What needs attention?<textarea name="summary" required minLength={5} maxLength={1000} rows={3} /></label>
        <label>Who raised this concern?
          <select name="assertedRole" required defaultValue="operator"><option value="operator">Ops concern</option><option value="worker">Worker told me</option><option value="hirer">Hirer told me</option></select>
        </label>
        <label>Participant (required when worker/hirer told me)
          <select name="assertedBy" defaultValue="" key={assignmentId}><option value="">Operator’s own concern</option>
            {assignment?.workerId && <option value={assignment.workerId}>Worker · {assignment.label}</option>}
            {assignment?.hirerId && <option value={assignment.hirerId}>Hirer · {assignment.label}</option>}
          </select>
        </label>
        <label>Source
          <select name="source" required defaultValue="operator_ui"><option value="operator_ui">Operator workspace</option><option value="call">Call</option><option value="in_person">In person</option></select>
        </label>
        {state.error && <p className={styles.error} role="alert">{state.error}</p>}
        {state.saved && <p className={styles.success} role="status">Exception opened.</p>}
        <button type="submit" disabled={pending}>{pending ? "Opening…" : "Open exception"}</button>
      </form>
    </details>
  );
}
