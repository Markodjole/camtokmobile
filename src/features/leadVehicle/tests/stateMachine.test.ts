import { describe, expect, it } from "vitest";
import { advanceLeadStateMachine } from "../domain/leadVehicle.stateMachine";

describe("leadVehicle.stateMachine", () => {
  it("acquires after confirmation window", () => {
    const mid = advanceLeadStateMachine("searching", {
      nowMs: 100,
      bestTrackId: "vehicle_1",
      bestScore: 0.8,
      currentLeadTrackId: null,
      currentLeadScore: 0,
      leadStillVisible: false,
      candidateSinceMs: null,
      switchChallengerId: null,
      switchChallengerSinceMs: null,
      lostSinceMs: null,
    });
    expect(mid.state).toBe("candidate_found");
    expect(mid.candidateSinceMs).toBe(100);

    const acquired = advanceLeadStateMachine("candidate_found", {
      nowMs: 700,
      bestTrackId: "vehicle_1",
      bestScore: 0.8,
      currentLeadTrackId: null,
      currentLeadScore: 0,
      leadStillVisible: false,
      candidateSinceMs: 100,
      switchChallengerId: null,
      switchChallengerSinceMs: null,
      lostSinceMs: null,
    });
    expect(acquired.transition).toBe("acquired");
    expect(acquired.leadTrackId).toBe("vehicle_1");
  });

  it("does not switch on small score fluctuations", () => {
    const out = advanceLeadStateMachine("tracking", {
      nowMs: 1000,
      bestTrackId: "vehicle_2",
      bestScore: 0.72,
      currentLeadTrackId: "vehicle_1",
      currentLeadScore: 0.7,
      leadStillVisible: true,
      candidateSinceMs: null,
      switchChallengerId: null,
      switchChallengerSinceMs: null,
      lostSinceMs: null,
    });
    expect(out.leadTrackId).toBe("vehicle_1");
    expect(out.transition).toBe("none");
  });

  it("requires confirmation before switching", () => {
    const first = advanceLeadStateMachine("tracking", {
      nowMs: 1000,
      bestTrackId: "vehicle_2",
      bestScore: 0.9,
      currentLeadTrackId: "vehicle_1",
      currentLeadScore: 0.7,
      leadStillVisible: true,
      candidateSinceMs: null,
      switchChallengerId: null,
      switchChallengerSinceMs: null,
      lostSinceMs: null,
    });
    expect(first.state).toBe("switching_vehicle");

    const done = advanceLeadStateMachine("switching_vehicle", {
      nowMs: 1600,
      bestTrackId: "vehicle_2",
      bestScore: 0.9,
      currentLeadTrackId: "vehicle_1",
      currentLeadScore: 0.7,
      leadStillVisible: true,
      candidateSinceMs: null,
      switchChallengerId: "vehicle_2",
      switchChallengerSinceMs: 1000,
      lostSinceMs: null,
    });
    expect(done.transition).toBe("switched");
    expect(done.leadTrackId).toBe("vehicle_2");
  });

  it("uses grace period before permanent loss", () => {
    const temp = advanceLeadStateMachine("tracking", {
      nowMs: 1000,
      bestTrackId: null,
      bestScore: 0,
      currentLeadTrackId: "vehicle_1",
      currentLeadScore: 0.7,
      leadStillVisible: false,
      candidateSinceMs: null,
      switchChallengerId: null,
      switchChallengerSinceMs: null,
      lostSinceMs: null,
    });
    expect(temp.state).toBe("temporarily_lost");
    expect(temp.transition).toBe("temporarily_lost");

    const lost = advanceLeadStateMachine("temporarily_lost", {
      nowMs: 2000,
      bestTrackId: null,
      bestScore: 0,
      currentLeadTrackId: "vehicle_1",
      currentLeadScore: 0.7,
      leadStillVisible: false,
      candidateSinceMs: null,
      switchChallengerId: null,
      switchChallengerSinceMs: null,
      lostSinceMs: 1000,
    });
    expect(lost.transition).toBe("lost");
    expect(lost.state).toBe("searching");
  });
});
