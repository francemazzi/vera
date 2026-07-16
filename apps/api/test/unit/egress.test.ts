import { describe, expect, it } from "vitest";

import { ApiProblem, assertLocalEgressAllowed } from "../../src/index.js";

describe("egress policy", () => {
  it("allows explicit local endpoints and rejects remote hosts", () => {
    expect(assertLocalEgressAllowed("http://127.0.0.1:11434/api/tags").hostname).toBe("127.0.0.1");
    expect(() => assertLocalEgressAllowed("https://example.com")).toThrow(ApiProblem);
  });
});
