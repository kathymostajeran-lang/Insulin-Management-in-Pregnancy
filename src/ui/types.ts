import type { Config } from "../logic/dosing";
import type { PatientModel } from "../model";
import type { PatientInputs } from "../config";

export interface TabProps {
  model: PatientModel;
  config: Config;
  inputs: PatientInputs;
}
