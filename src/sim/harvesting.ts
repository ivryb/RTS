import type { SimPoint } from "./units";

/** Positions and footprint radii use simulation millimetres; resource amounts are whole units. */
export interface TitaniumDepositState {
  id: string;
  position: SimPoint;
  radius: number;
  amount: number;
  initialAmount: number;
}

export type HarvestState = { depositId: string } & (
  | { phase: "to-deposit" | "extracting"; workPosition: SimPoint }
  | { phase: "to-dropoff"; dropoffId: string; workPosition: SimPoint }
  | { phase: "waiting-deposit" | "waiting-dropoff" }
);

export const SCOUT_TITANIUM_CAPACITY = 20;
export const TITANIUM_PER_EXTRACTION = 2;
export const EXTRACTION_INTERVAL_TICKS = 5;
