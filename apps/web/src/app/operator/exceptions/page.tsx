import { redirect } from "next/navigation";

import { OperatorChrome } from "../../../components/operator/OperatorChrome";
import {
  listAssignmentOptions,
  listExceptions,
  type ExceptionQueueItem,
} from "../../../features/exceptions/queries";
import { getOperatorClient } from "../../../features/work-graph/queries";
import { ExceptionCard } from "./ExceptionCard";
import { OpenExceptionForm } from "./OpenExceptionForm";
import styles from "./exceptions.module.css";

type PageProps = { searchParams: Promise<{ status?: string }> };
type Filter = "active" | "resolved" | "all";

function selectedFilter(value: string | undefined): Filter {
  return value === "resolved" || value === "all" ? value : "active";
}

export default async function ExceptionsPage({ searchParams }: PageProps) {
  const supabase = await getOperatorClient();
  if (!supabase) redirect("/sign-in?reason=not-authorised");
  const filter = selectedFilter((await searchParams).status);
  const [items, assignments] = await Promise.all([
    listExceptions(filter),
    listAssignmentOptions(),
  ]);
  const activeCount = items.filter(
    (item) => item.state === "open" || item.state === "under_review",
  ).length;
  return (
    <OperatorChrome>
      <main className={styles.shell}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Ops queue</p>
            <h1>Exceptions</h1>
            <p>
              Resolve operational issues while keeping each participant’s claim
              and evidence separate.
            </p>
          </div>
          <span className={styles.count}>
            {filter === "active" ? activeCount : items.length}{" "}
            {filter === "active" ? "active" : "shown"}
          </span>
        </header>
        <nav className={styles.filters} aria-label="Exception filters">
          {(["active", "resolved", "all"] as const).map((value) => (
            <a
              key={value}
              aria-current={filter === value ? "page" : undefined}
              href={`/operator/exceptions?status=${value}`}
            >
              {value === "active"
                ? "Active"
                : value === "resolved"
                  ? "Resolved history"
                  : "All"}
            </a>
          ))}
        </nav>
        <OpenExceptionForm
          assignments={assignments}
          submissionNonce={crypto.randomUUID()}
        />
        {items.length === 0 ? (
          <div className={styles.empty}>
            <strong>
              {filter === "resolved" ? "No resolved exceptions" : "Queue clear"}
            </strong>
            <span>
              {filter === "resolved"
                ? "Resolved history will appear here."
                : "Nothing needs operator attention right now."}
            </span>
          </div>
        ) : (
          <div className={styles.list}>
            {items.map((item: ExceptionQueueItem) => (
              <ExceptionCard
                item={item}
                key={item.id}
                claimNonce={crypto.randomUUID()}
                resolveNonce={crypto.randomUUID()}
              />
            ))}
          </div>
        )}
      </main>
    </OperatorChrome>
  );
}
