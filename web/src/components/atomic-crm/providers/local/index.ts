import { useDataProvider } from "ra-core";

import { dataProvider as fakerestDataProvider } from "../fakerest";
import type { CrmDataProvider } from "../types";
import { DATA_MODE } from "./config";
import { localApiMethods } from "./httpClient";
import { snapshotMethods } from "./snapshotClient";
import type { DonorDeskMethods } from "./types";

export const donorDeskMethods: DonorDeskMethods =
  DATA_MODE === "local" ? localApiMethods : snapshotMethods;

export type DonorDeskDataProvider = CrmDataProvider & DonorDeskMethods;

/**
 * The CRM keeps FakeRest for the atomic-crm screens it still shows (login,
 * notes, tags). Every Donor Desk screen reads the donor methods, which call
 * the local API or the snapshot depending on VITE_DATA_MODE.
 */
export const dataProvider: DonorDeskDataProvider = {
  ...fakerestDataProvider,
  ...donorDeskMethods,
};

export const useDonorDesk = () => useDataProvider<DonorDeskDataProvider>();

export { DATA_MODE } from "./config";
export type * from "./types";
