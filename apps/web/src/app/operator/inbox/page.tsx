import { redirect } from "next/navigation";

import { OperatorChrome } from "../../../components/operator/OperatorChrome";
import { getOperatorClient } from "../../../features/work-graph/queries";
import {
  listFailedDeliveries,
  listInboxItems,
} from "../../../features/ops-inbox/queries";
import { InboxItemCard } from "./InboxItemCard";
import styles from "./inbox.module.css";

export default async function OpsInboxPage() {
  const supabase = await getOperatorClient();
  if (!supabase) redirect("/sign-in?reason=not-authorised");

  const [items, failedDeliveries] = await Promise.all([
    listInboxItems(),
    listFailedDeliveries(),
  ]);

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
        <section
          className={styles.failures}
          aria-labelledby="failed-deliveries-heading"
        >
          <header className={styles.failuresHeader}>
            <div>
              <p className={styles.eyebrow}>Communication fallback</p>
              <h2 id="failed-deliveries-heading">Failed WhatsApp deliveries</h2>
            </div>
            <span className={styles.count}>
              {failedDeliveries.length} failed
            </span>
          </header>
          {failedDeliveries.length === 0 ? (
            <p className={styles.meta}>No failed deliveries need follow-up.</p>
          ) : (
            <ul className={styles.failureList}>
              {failedDeliveries.map((delivery) => (
                <li className={styles.failureCard} key={delivery.id}>
                  <strong>{delivery.messageKey}</strong>
                  <p className={styles.error}>{delivery.failureReason}</p>
                  <p className={styles.meta}>
                    Created {new Date(delivery.createdAt).toLocaleString()}
                  </p>
                  <p className={styles.callInstruction}>
                    Call the participant at{" "}
                    <a href={`tel:${delivery.recipientPhoneNumber}`}>
                      {delivery.recipientPhoneNumber}
                    </a>{" "}
                    and resolve the communication follow-up.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </OperatorChrome>
  );
}
