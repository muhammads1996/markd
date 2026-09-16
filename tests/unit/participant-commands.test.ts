import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  apiUrl,
  createParticipantApiRequest,
} from "../../apps/web/src/lib/participant/commands";

describe("participant command boundary", () => {
  it("builds authenticated, idempotent FastAPI command requests", () => {
    const request = createParticipantApiRequest(
      {
        path: "/api/v1/assignments/assignment-1/respond",
        method: "POST",
        body: { response: "accepted", expected_version: 3 },
        idempotencyKey: "assignment-response-1",
      },
      "access-token",
      "correlation-1",
    );

    expect(apiUrl("/api/v1/me")).toMatch(/\/api\/v1\/me$/);
    expect(request.headers).toMatchObject({
      Authorization: "Bearer access-token",
      "Idempotency-Key": "assignment-response-1",
      "X-Correlation-Id": "correlation-1",
    });
    expect(request.body).toBe('{"response":"accepted","expected_version":3}');
  });

  it("has no participant Next API route and directs command paths to FastAPI v1", () => {
    const participantApiDirectory = resolve("apps/web/src/app/api/participant");
    const commandSource = readFileSync(
      resolve("apps/web/src/lib/participant/commands.ts"),
      "utf8",
    );

    expect(existsSync(participantApiDirectory)).toBe(false);
    expect(commandSource).toContain(
      "path: `/api/v1/assignments/${assignmentId}/respond`",
    );
    expect(commandSource).toContain(
      "path: `/api/v1/assignments/${assignmentId}/stamps`",
    );
    expect(commandSource).toContain(
      "path: `/api/v1/workers/${workerId}/availability/${workDate}`",
    );
    expect(commandSource).toContain('path: "/api/v1/labour-requests"');
  });
});
