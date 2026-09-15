import "server-only";

export function isInternalServiceRequestAuthorized(request: Request): boolean {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(
    serviceRoleKey &&
    request.headers.get("authorization") === `Bearer ${serviceRoleKey}`,
  );
}
