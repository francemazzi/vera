import { describe, expect, it } from "vitest";

import { probeOllama } from "@vera/benchmark";

describe("demo MVP Ollama local smoke", () => {
  it("records loopback Ollama availability or an explicit limitation", async () => {
    const result = await probeOllama(undefined, 500);

    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    if (result.available) {
      expect(result.runtimeVersion).not.toBeNull();
    } else {
      expect(result.limitation).toContain("Ollama local smoke was not available");
    }
  });
});
