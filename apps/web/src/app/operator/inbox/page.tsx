import { redirect } from "next/navigation";

import { getOperatorClient } from "../../../features/work-graph/queries";
import { listInboxItems } from "../../../features/ops-inbox/queries";
import { InboxItemCard } from "./InboxItemCard";
import styles from "./inbox.module.css";

export default async function OpsInboxPage() {
  const supabase = await getOperatorClient();
  if (!supabase) redirect("/sign-in?reason=not-authorised");

  const items = await listInboxItems();

  return (
    <main className={styles.shell}>
      <header>
        <p className={styles.eyebrow}>Ops Inbox</p>
        <h1>WhatsApp events awaiting review</h1>
        <p>
          Confirm, edit, reject or defer each proposed action before it touches
          the Work Graph.
        </p>
      </header>
      {items.length === 0 ? (
        <p className={styles.empty}>Nothing waiting for review.</p>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <InboxItemCard item={item} key={item.id} />
          ))}
        </div>
      )}
    </main>
  );
}
