import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../lib/supabase/server";

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
    <main className="shell operator-shell">
      <section className="intro" aria-labelledby="operator-title">
        <p className="eyebrow">Signed in operator</p>
        <h1 id="operator-title">Today</h1>
        <p className="lede">Your private Work Graph workspace is ready.</p>
        <p className="status">
          Role: {role === "ops_admin" ? "Ops admin" : "Ops user"}
        </p>
        <p>
          <a href="/operator/inbox">Ops Inbox</a>
        </p>
        <form action="/auth/sign-out" method="post">
          <button type="submit">Sign out</button>
        </form>
      </section>
    </main>
  );
}
