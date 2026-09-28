export function isValidParticipantPhone(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

export function isParticipantActivationGranted(value: unknown): boolean {
  return value === true;
}

export function isActiveParticipantAccount(
  authUserId: string,
  account: unknown,
): boolean {
  if (
    typeof account !== "object" ||
    account === null ||
    Array.isArray(account)
  ) {
    return false;
  }
  return (
    "auth_user_id" in account &&
    account.auth_user_id === authUserId &&
    "status" in account &&
    account.status === "active"
  );
}
