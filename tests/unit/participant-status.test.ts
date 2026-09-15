import { describe, expect, it } from "vitest";

import { getAssignmentStatusTone } from "../../apps/web/src/lib/participant/types";

describe("participant assignment status tone", () => {
  it("never presents accepted and waiting as confirmed", () => {
    expect(getAssignmentStatusTone("accepted_waiting")).toBe("warning");
    expect(getAssignmentStatusTone("accepted_waiting")).not.toBe("confirmed");
    expect(getAssignmentStatusTone("confirmed_travel_ready")).toBe("confirmed");
  });
});
