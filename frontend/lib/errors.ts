import { CONTRACT_ID, USDC_ID } from "./deployment";

/** Contract error codes 1–21 (docs/contract-interface.md) in plain words. */
export const CONTRACT_ERRORS: Record<number, { name: string; message: string }> = {
  1: { name: "InvalidConfig", message: "The contract settings are invalid. This is a deployment problem, not something you did." },
  2: { name: "StoreAlreadyRegistered", message: "This store is already approved. Change its limit instead." },
  3: { name: "StoreNotRegistered", message: "This address is not an approved store." },
  4: { name: "StoreFrozen", message: "This store is frozen and can't issue new rug certificates." },
  5: { name: "InvalidLimit", message: "The limit can't be below zero." },
  6: { name: "InvalidPrice", message: "Enter a price above zero." },
  7: { name: "InvalidMonths", message: "Pick a loan length from 1 to 12 months." },
  8: { name: "InvalidDescription", message: "The description must be 1 to 280 characters long." },
  9: { name: "InvalidAmount", message: "That amount isn't valid." },
  10: { name: "RugNotFound", message: "There is no rug with that number." },
  11: { name: "RugNotFree", message: "This rug is already waiting for an investor, held as security, or collected." },
  12: { name: "NotRugOwner", message: "Only the rug's holder can do this. Switch to the holder's account in Freighter." },
  13: { name: "StoreLimitExceeded", message: "The store's limit is used up. It can take this loan once other loans close." },
  14: { name: "LoanNotFound", message: "There is no loan with that number." },
  15: { name: "LoanNotRequested", message: "This request has already been funded or cancelled." },
  16: { name: "LoanNotFunded", message: "This loan isn't running: nobody has funded it, or it was cancelled." },
  17: { name: "LoanSettled", message: "This loan is already closed." },
  18: { name: "TooEarly", message: "The loan isn't due yet. The store can buy the rug once it is due." },
  19: { name: "BuyoutWindowClosed", message: "The store's buy-out window has closed. The investor can now take the rug." },
  20: { name: "BuyoutWindowOpen", message: "The store can still buy the rug. You can take it once the buy-out window closes." },
  21: { name: "InvalidState", message: "The contract found records that don't match. Refresh and try again." },
};

/** Errors from the USDC token contract (Stellar Asset Contract). */
const USDC_ERRORS: Record<number, string> = {
  6: "This account doesn't exist on testnet yet. Fund it with test XLM first.",
  8: "That amount isn't valid.",
  10: "There isn't enough test USDC in this wallet.",
  11: "This wallet's USDC is not authorised by the issuer.",
  13: "This wallet can't hold test USDC yet. Add USDC to the wallet first.",
};

export class AppError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly source: "rugdealer" | "usdc" | "auth" | "wallet" | "network" | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "AppError";
  }
}

const ERROR_RE = /contract:(C[A-Z2-7]{55}),\s*topics:\[error,\s*Error\(Contract,\s*#(\d+)\)\]/g;

/** Turn a simulation or transaction error string into a plain message. */
export function explainError(raw: string): AppError {
  const hits = [...raw.matchAll(ERROR_RE)].map((m) => ({ contract: m[1], code: Number(m[2]) }));
  const usdc = hits.find((h) => h.contract === USDC_ID);
  if (usdc && USDC_ERRORS[usdc.code]) return new AppError(USDC_ERRORS[usdc.code], usdc.code, "usdc");
  const ours = hits.find((h) => h.contract === CONTRACT_ID);
  if (ours && CONTRACT_ERRORS[ours.code]) return new AppError(CONTRACT_ERRORS[ours.code].message, ours.code, "rugdealer");
  // Without diagnostic events, the bare code is ours.
  const bare = /Error\(Contract,\s*#(\d+)\)/.exec(raw);
  if (!hits.length && bare && CONTRACT_ERRORS[Number(bare[1])]) {
    const code = Number(bare[1]);
    return new AppError(CONTRACT_ERRORS[code].message, code, "rugdealer");
  }
  if (/Error\(Auth,/.test(raw))
    return new AppError("This needs a signature from a different account. Switch accounts in Freighter.", undefined, "auth");
  if (/Error\(Storage, MissingValue\)|Account not found|AccountMissing/.test(raw))
    return new AppError("This account doesn't exist on testnet yet. Fund it with test XLM first.", undefined, "network");
  return new AppError("The network refused this action. Refresh and check the account, then try again.", undefined, "unknown");
}

export function messageOf(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof Error) {
    if (/Failed to fetch|NetworkError|ECONN|timeout/i.test(e.message))
      return "Couldn't reach the Stellar testnet. Check your connection and refresh.";
    return e.message;
  }
  return String(e);
}
