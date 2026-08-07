import type { Config, WindowState } from "../logic/dosing";
import type { PatientModel } from "../model";
import type { PatientInputs } from "../config";

/** The four SMBG/CGM windows the titration engine reads, as in/high/low. Used to
 *  hand a CGM-derived pattern straight into the Adjust module (no re-typing). */
export type AdjustPattern = Record<"fasting" | "postBreakfast" | "postLunch" | "postDinner", WindowState>;

export interface TabProps {
  model: PatientModel;
  config: Config;
  inputs: PatientInputs;
  /** Route to another module (e.g. Start → Adjust). */
  onNavigate?: (id: string) => void;
  /** Pattern seeded by CGM for the Adjust module to pick up on mount. */
  adjustSeed?: AdjustPattern | null;
  /** CGM sets the seed the Adjust module will consume. */
  onSeedAdjust?: (seed: AdjustPattern) => void;
}
