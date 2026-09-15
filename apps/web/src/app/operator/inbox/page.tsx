import { redirect } from "next/navigation";

import { OperatorChrome } from "../../../components/operator/OperatorChrome";
import { getOperatorClient } from "../../../features/work-graph/queries";
import { listInboxItems } from "../../../features/ops-inbox/queries";
import { InboxItemCard } from "./InboxItemCard";
import styles from "./inbox.module.css";

export default async function OpsInboxPage() {
  const supabase = await getOperatorClient();
  if (!supabase) redirect("/sign-in?reason=not-authorised");

  const items = await listInboxItems();

  return (
    <OperatorChrome>
      <main className={styles.shell}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Ops Inbox</p>
            <h1>WhatsApp events awaiting review</h1>
          </div>
          <span className={styles.count}>{items.length} pending</span>
          <p>
            Confirm, edit or reject each proposed action before it touches the
            Work Graph.
          </p>
        </header>
        {items.length === 0 ? (
          <div className={styles.empty}>
            <strong>Inbox clear</strong>
            <span>Nothing is waiting for review.</span>
          </div>
        ) : (
          <div className={styles.list}>
            {items.map((item) => (
              <InboxItemCard item={item} key={item.id} />
            ))}
          </div>
        )}
      </main>
    </OperatorChrome>
  );
}
