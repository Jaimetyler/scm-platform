import type { LateFeeOfficeConfig } from "./types";

export const officeConfigs = {
  dallas: {
    office: "Dallas",

    revenueCodes: ["DAVIS"],

    excludedMovementStatuses: ["D", "V", "P"],

    excludedBrokerageStatuses: [
      "FINISHED",
      "RC_SENT",
      "RC_EXP",
    ],

    policyMatch: "PU",

    graceRule: "ignore_if_doc_cutoff_exists",
  },

  savannah: {
    office: "Savannah",

    revenueCodes: ["MAIN"],

    excludedMovementStatuses: ["D", "V", "P"],

    excludedBrokerageStatuses: [
      "FINISHED",
      "RC_SENT",
      "RC_EXP",
    ],

    policyMatch: "PU",

    graceRule: "always_apply",
  },
} satisfies Record<string, LateFeeOfficeConfig>;