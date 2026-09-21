import { redirect } from "next/navigation";

import { OperatorChrome } from "../../components/operator/OperatorChrome";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import styles from "./operator.module.css";

export default async function OperatorPage() {
  let userId: string | undefined;
  let role: "ops_admin" | "ops_user" | undefined;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    userId = userData.user?.id;
    if (userId) {
      const { data } = await supabase
        .from("operator_accounts")
        .select("role")
        .is("archived_at", null)
        .maybeSingle();
      role = data?.role as typeof role;
    }
  } catch {
    redirect("/sign-in?reason=configuration");
  }

  if (!userId) redirect("/sign-in");
  if (!role) redirect("/sign-in?reason=not-authorised");

  return (
    <OperatorChrome>
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Field workspace</p>
          <h1 id="operator-title">Today</h1>
          <p>Your private Work Graph workspace.</p>
        </header>
        <section className={styles.statusBand} aria-label="Operator session">
          <div>
            <span>Signed in</span>
            <strong>{role === "ops_admin" ? "Ops admin" : "Ops user"}</strong>
          </div>
          <span className={styles.liveMark}>Active</span>
        </section>
        <section className={styles.actions} aria-labelledby="today-actions">
          <div className={styles.sectionHeading}>
            <p>Available now</p>
            <h2 id="today-actions">Operator actions</h2>
          </div>
          <div className={styles.actionGrid}>
            <a href="/operator/inbox">
              <span>01</span>
              <strong>Review Inbox</strong>
              <small>Check proposed WhatsApp actions</small>
            </a>
            <a href="/operator/exceptions">
              <span>03</span>
              <strong>Review Exceptions</strong>
              <small>Keep claims, evidence and resolutions together</small>
            </a>
            <a href="/operator/onboard">
              <span>04</span>
              <strong>Add a record</strong>
              <small>Capture a worker or contractor</small>
            </a>
            <a href="/search">
              <span>05</span>
              <strong>Search Work Graph</strong>
              <small>Find people, work and places</small>
            </a>
          </div>
        </section>
      </main>
    </OperatorChrome>
  );
}
