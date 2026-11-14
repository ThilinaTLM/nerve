import { policy } from "./define-policy.js";
import { searchCandidate } from "../candidates/search.js";

/** A list of results (`details.results`, each with title, url and a snippet): every result keeps a bounded share. */
export const searchResultPolicy = policy(
  "search_summaries",
  "item_aware",
  searchCandidate,
);
