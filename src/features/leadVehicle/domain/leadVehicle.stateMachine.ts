import {
  LEAD_ACQUISITION_CONFIRMATION_MS,
  LEAD_LOSS_GRACE_PERIOD_MS,
  LEAD_SWITCH_CONFIRMATION_MS,
  LEAD_SWITCH_SCORE_MARGIN,
} from "./leadVehicle.constants";
import type {
  LeadVehicleTrackingState,
  VehicleTrackId,
} from "./leadVehicle.types";

export interface LeadStateMachineInput {
  nowMs: number;
  bestTrackId: VehicleTrackId | null;
  bestScore: number;
  currentLeadTrackId: VehicleTrackId | null;
  currentLeadScore: number;
  leadStillVisible: boolean;
  candidateSinceMs: number | null;
  switchChallengerId: VehicleTrackId | null;
  switchChallengerSinceMs: number | null;
  lostSinceMs: number | null;
}

export interface LeadStateMachineOutput {
  state: LeadVehicleTrackingState;
  leadTrackId: VehicleTrackId | null;
  candidateSinceMs: number | null;
  switchChallengerId: VehicleTrackId | null;
  switchChallengerSinceMs: number | null;
  lostSinceMs: number | null;
  transition:
    | "none"
    | "acquired"
    | "lost"
    | "temporarily_lost"
    | "reacquired"
    | "switched";
  switchReason?:
    | "previous_lost"
    | "challenger_more_relevant"
    | "lane_or_corridor_change"
    | "manual_reset";
}

export function advanceLeadStateMachine(
  prevState: LeadVehicleTrackingState,
  input: LeadStateMachineInput,
): LeadStateMachineOutput {
  const {
    nowMs,
    bestTrackId,
    bestScore,
    currentLeadTrackId,
    currentLeadScore,
    leadStillVisible,
  } = input;

  if (prevState === "idle" || prevState === "stopped" || prevState === "error") {
    return base(prevState, input, "none");
  }

  if (prevState === "warming_up") {
    return {
      ...base("searching", input, "none"),
      state: "searching",
      leadTrackId: null,
    };
  }

  // No lead yet — acquire with confirmation.
  if (!currentLeadTrackId) {
    if (!bestTrackId) {
      return {
        ...base("searching", input, "none"),
        candidateSinceMs: null,
      };
    }
    const since = input.candidateSinceMs ?? nowMs;
    if (nowMs - since < LEAD_ACQUISITION_CONFIRMATION_MS) {
      return {
        state: "candidate_found",
        leadTrackId: null,
        candidateSinceMs: since,
        switchChallengerId: null,
        switchChallengerSinceMs: null,
        lostSinceMs: null,
        transition: "none",
      };
    }
    return {
      state: "tracking",
      leadTrackId: bestTrackId,
      candidateSinceMs: null,
      switchChallengerId: null,
      switchChallengerSinceMs: null,
      lostSinceMs: null,
      transition: "acquired",
    };
  }

  // Lead exists but not visible.
  if (!leadStillVisible) {
    const lostSince = input.lostSinceMs ?? nowMs;
    if (nowMs - lostSince < LEAD_LOSS_GRACE_PERIOD_MS) {
      return {
        state: "temporarily_lost",
        leadTrackId: currentLeadTrackId,
        candidateSinceMs: null,
        switchChallengerId: null,
        switchChallengerSinceMs: null,
        lostSinceMs: lostSince,
        transition:
          prevState === "temporarily_lost" ? "none" : "temporarily_lost",
      };
    }
    // Permanent loss — maybe promote challenger.
    if (bestTrackId && bestTrackId !== currentLeadTrackId) {
      return {
        state: "tracking",
        leadTrackId: bestTrackId,
        candidateSinceMs: null,
        switchChallengerId: null,
        switchChallengerSinceMs: null,
        lostSinceMs: null,
        transition: "switched",
        switchReason: "previous_lost",
      };
    }
    return {
      state: "searching",
      leadTrackId: null,
      candidateSinceMs: null,
      switchChallengerId: null,
      switchChallengerSinceMs: null,
      lostSinceMs: null,
      transition: "lost",
    };
  }

  // Lead visible — hysteresis for switching.
  if (
    bestTrackId &&
    bestTrackId !== currentLeadTrackId &&
    bestScore >= currentLeadScore + LEAD_SWITCH_SCORE_MARGIN
  ) {
    const challengerId = bestTrackId;
    const since =
      input.switchChallengerId === challengerId
        ? (input.switchChallengerSinceMs ?? nowMs)
        : nowMs;
    if (nowMs - since < LEAD_SWITCH_CONFIRMATION_MS) {
      return {
        state: "switching_vehicle",
        leadTrackId: currentLeadTrackId,
        candidateSinceMs: null,
        switchChallengerId: challengerId,
        switchChallengerSinceMs: since,
        lostSinceMs: null,
        transition: "none",
      };
    }
    return {
      state: "tracking",
      leadTrackId: challengerId,
      candidateSinceMs: null,
      switchChallengerId: null,
      switchChallengerSinceMs: null,
      lostSinceMs: null,
      transition: "switched",
      switchReason: "challenger_more_relevant",
    };
  }

  return {
    state: "tracking",
    leadTrackId: currentLeadTrackId,
    candidateSinceMs: null,
    switchChallengerId: null,
    switchChallengerSinceMs: null,
    lostSinceMs: null,
    transition: prevState === "temporarily_lost" ? "reacquired" : "none",
  };
}

function base(
  state: LeadVehicleTrackingState,
  input: LeadStateMachineInput,
  transition: LeadStateMachineOutput["transition"],
): LeadStateMachineOutput {
  return {
    state,
    leadTrackId: input.currentLeadTrackId,
    candidateSinceMs: input.candidateSinceMs,
    switchChallengerId: input.switchChallengerId,
    switchChallengerSinceMs: input.switchChallengerSinceMs,
    lostSinceMs: input.lostSinceMs,
    transition,
  };
}
