import { expect, test } from "@playwright/test";
import { Client } from "pg";

const localDatabaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const authInstanceId = "00000000-0000-0000-0000-000000000000";
const password = "Markd-e2e-only-2026!";

let email = "";

test.beforeAll(async ({}, workerInfo) => {
  const mobile = workerInfo.project.name.includes("mobile");
  const userId = mobile
    ? "92000000-0000-4000-8000-000000000002"
    : "92000000-0000-4000-8000-000000000001";
  email = mobile ? "mobile-operator@example.test" : "web-operator@example.test";
  const client = new Client({ connectionString: localDatabaseUrl });
  await client.connect();
  try {
    await client.query(
      `insert into auth.users(
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, confirmation_token, recovery_token, email_change,
        email_change_token_current, email_change_token_new, reauthentication_token,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) values (
        $1, $2, 'authenticated', 'authenticated', $3,
          crypt($4, gen_salt('bf')), now(), '', '', '', '', '', '', '{}', '{}', now(), now()
      )
      on conflict (id) do update set
        email = excluded.email,
        encrypted_password = excluded.encrypted_password,
        email_confirmed_at = excluded.email_confirmed_at,
          confirmation_token = ''::text,
        recovery_token = ''::text,
        email_change = ''::text,
        email_change_token_current = ''::text,
        email_change_token_new = ''::text,
        reauthentication_token = ''::text,
        updated_at = now()`,
      [userId, authInstanceId, email, password],
    );
    await client.query(
      `insert into public.operator_accounts(user_id, role)
       values ($1, 'ops_user')
       on conflict (user_id) do update set role = excluded.role, archived_at = null`,
      [userId],
    );
  } finally {
    await client.end();
  }
});

test("supports phone-sized onboarding, search, editing, and relationship history", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/operator$/);

  await page.goto("/operator/onboard");
  await expect(
    page.getByRole("heading", { name: "Add someone to MARKD" }),
  ).toBeVisible();
  await expect(page.getByLabel("Preferred name")).toBeVisible();
  await expect(page.getByLabel("Communication preference")).toBeVisible();
  await expect(
    page.getByText("Optional participation preferences"),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto(
    "/operator/onboard?workerId=10000000-0000-4000-8000-000000000001",
  );
  await expect(
    page.getByRole("heading", { name: "Update MARKD record" }),
  ).toBeVisible();
  await expect(page.getByLabel("Preferred name")).toHaveValue("Anele Sample");
  await expectNoHorizontalOverflow(page);

  await page.goto("/search?q=%2B27%2082%20000%200002");
  await expect(page.getByText("Example Build", { exact: true })).toBeVisible();
  await expect(page.getByText("+27820000002")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.goto("/workers/10000000-0000-4000-8000-000000000001");
  await expect(page.getByText("MARKD-arranged work")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Demonstrated skills" }),
  ).toBeVisible();
  await expect(
    page.getByText("Confirmed Workmark evidence from work history"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit worker" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/workers/10000000-0000-4000-8000-000000000003");
  await expect(page.getByText("Historical claim")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/contractors/20000000-0000-4000-8000-000000000001");
  await expect(
    page.getByRole("heading", { name: "Known labour network" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Edit contractor" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const overflows = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
}
