export type { Database, Json } from "./database.types";
export type {
  Enums,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "./database.types";

export type Workmark = import("./database.types").Tables<"workmarks">;
export type VerificationClaim =
  import("./database.types").Tables<"verification_claims">;
export type WorkerOrganisationRelationship =
  import("./database.types").Tables<"worker_organisation_relationships">;
