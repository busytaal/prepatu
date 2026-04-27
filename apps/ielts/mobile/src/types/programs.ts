export type Program = {
  id: string;
  name: string;
  subtitle: string;
  language: string;
  language_code: string;
  /** Hex accent colour for this program, e.g. "#3ECF6A" */
  accent: string;
  flow: string;
  scoring: "ielts" | null;
  description?: string;
};

export type CueCardParams = {
  cardType: "cue_card";
  title: string;
  topic: string;
  points: string[];
  question: string;
  /** Optional instruction line shown above the timer, e.g. "You have 1 minute to prepare." */
  instructions?: string;
};

export type ProgramsResponse = {
  version?: string;
  programs: Program[];
};
