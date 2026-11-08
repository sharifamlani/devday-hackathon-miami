import { useDataProvider } from "ra-core";

import { dataProvider as fakerestDataProvider } from "../fakerest";
import type { CrmDataProvider } from "../types";
import { DATA_MODE } from "./config";
import { crmHttpMethods } from "./crmHttp";
import { withDonorCrm } from "./crmResources";
import { crmSnapshotMethods } from "./crmSnapshot";
import { localApiMethods } from "./httpClient";
import { snapshotMethods } from "./snapshotClient";
import type { DonorDeskMethods } from "./types";

// The base methods omit the Phase 5E (three tabs) ones, which live in crm*.ts.
export const donorDeskMethods: DonorDeskMethods =
  DATA_MODE === "local"
    ? { ...localApiMethods, ...crmHttpMethods }
    : { ...snapshotMethods, ...crmSnapshotMethods };

export type DonorDeskDataProvider = CrmDataProvider & DonorDeskMethods;

/**
 * The Donors tab's react-admin resources (contacts = donors, companies =
 * organizations, notes, tasks, tags) read the donor data (crmResources.ts);
 * FakeRest keeps the rest (the signed-in user, configuration). Every Donor
 * Desk screen reads the donor methods, which call the local API or the
 * snapshot depending on VITE_DATA_MODE.
 */
export const dataProvider: DonorDeskDataProvider = {
  ...withDonorCrm(fakerestDataProvider),
  ...donorDeskMethods,
};

export const useDonorDesk = () => useDataProvider<DonorDeskDataProvider>();

export { DATA_MODE, SOCIAL_POSTING } from "./config";
export type * from "./types";
export type * from "./crmTypes";
export { TABS, TAB_LABELS } from "./crmTypes";
export { NOT_RECORDED, buildApproval } from "./crmParse";
