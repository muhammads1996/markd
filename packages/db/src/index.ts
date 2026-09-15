export type { Database, Json } from "./database.types";
export type {
  Enums,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "./database.types";

export type Workmark = import("./database.types").Tables<"workmarks">;
export type OperatorAccount =
  import("./database.types").Tables<"operator_accounts">;
export type VerificationClaim =
  import("./database.types").Tables<"verification_claims">;
export type OperatorWorkCard =
  import("./database.types").Tables<"operator_work_cards">;
export type WorkerOrganisationRelationship =
  import("./database.types").Tables<"worker_organisation_relationships">;
