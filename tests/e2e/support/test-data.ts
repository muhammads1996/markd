import { faker } from "@faker-js/faker";

export type OperatorRole = "ops_admin" | "ops_user";

export type OperatorUserFixtureData = {
  id: string;
  email: string;
  password: string;
  displayName: string;
  role: OperatorRole;
};

// Faker-generated test data; only ever runs against the local Supabase
// instance from tests/e2e, never shipped in application code.
export function buildOperatorUser(
  overrides: Partial<OperatorUserFixtureData> = {},
): OperatorUserFixtureData {
  return {
    id: faker.string.uuid(),
    email: `operator-${faker.string.alphanumeric({ length: 12, casing: "lower" })}@example.test`,
    password: `Markd-${faker.string.alphanumeric({ length: 8 })}-2026!`,
    displayName: faker.person.fullName(),
    role: "ops_user",
    ...overrides,
  };
}
