import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getOperatorClient,
  searchWorkGraph,
} from "../../features/work-graph/queries";
import styles from "./search.module.css";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!(await getOperatorClient())) redirect("/sign-in?reason=not-authorised");
  const query = (await searchParams).q?.trim() ?? "";
  const results = await searchWorkGraph(query);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Work Graph</p>
        <h1>Search people, work and places</h1>
        <p>
          Search names, phone numbers, contractors, site areas and demonstrated
          skills.
        </p>
      </header>
      <form className={styles.form} action="/search">
        <label htmlFor="work-graph-query">Search the private Work Graph</label>
        <div>
          <input
            id="work-graph-query"
            name="q"
            defaultValue={query}
            autoFocus
          />
          <button type="submit">Search</button>
        </div>
      </form>
      {query ? (
        <section aria-live="polite">
          <h2>
            {results.length
              ? `${results.length} matching records`
              : "No matching records"}
          </h2>
          {results.length === 0 ? (
            <p className={styles.empty}>
              Try a full name, E.164 phone number, site area, or skill.
            </p>
          ) : (
            <ul className={styles.results}>
              {results.map((result) => (
                <li key={`${result.kind}-${result.id}`}>
                  <Link href={result.href}>
                    <span className={styles.kind}>{result.kind}</span>
                    <strong>{result.title}</strong>
                    <small>{result.detail}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className={styles.empty}>
          Start with a person, phone number, contractor, site area, or skill.
        </p>
      )}
    </main>
  );
}
