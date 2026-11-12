// Public testnet deployment data. Mirrors docs/testnet-deployment.json.
// Nothing secret lives here: only public keys, contract IDs and parameters.

export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";
export const EXPLORER_URL = "https://stellar.expert/explorer/testnet";

export const CONTRACT_ID = "CB54ULGYOA6LLKYGRFGBA5FVCH3WH6B4YVGAOEMTDKHNBXCPZ4XOQFWG";
export const USDC_ID = "CCKKWM4ROXHPJAALYDXWL676MUB6OKGSWAZUOTB5SJIBWQ3B5ZDQZ3OM";
export const USDC_CODE = "USDC";
export const USDC_ISSUER = "GAWNPX6FZB7B7TZP6WC2H6L7AOYRXPBRDBWPISSAIFQPZX7GAQO3TWRY";

/** Ledger that deployed the contract. The event feed starts here (or at the
 * oldest ledger the RPC still keeps, whichever is later). */
export const DEPLOY_LEDGER = 5688349;

export const ACCOUNTS = {
  admin: "GCXRZRWAXQ2HDXIUAC5BZRZOLMD3RGLU42K64VHWCQV57CGXJWQTVCIZ",
  issuer: "GAWNPX6FZB7B7TZP6WC2H6L7AOYRXPBRDBWPISSAIFQPZX7GAQO3TWRY",
  store: "GBWCNPACZXNZKJKB7NA2EHRCZTNWT3LQBEHTYPTVF5X6VZNU5RXPPLCN",
  store2: "GDWBZD65XOYVVDMQHOST5SEQH4ZBXZTADY3NJIOGMYSYYVGK5RAFZ5RQ",
  weaver: "GBH4TKU2HPW7PGY5BCDU73E3PMZUK7TQ7RVDHP5QDTK23BHKW2XDGOQF",
  investor: "GCVBINDMVFUMQ3OBUVQGE6RFBWWBHSRKSLEQVZ6I7XQNQR2424HQOA2W",
} as const;

/** Stores known from the deployment. More are discovered from events. */
export const KNOWN_STORES: string[] = [ACCOUNTS.store, ACCOUNTS.store2];

export type DemoRole = "platform" | "store" | "weaver" | "investor" | "issuer";

/** Friendly names for the demo accounts, so nobody has to read addresses. */
export const DEMO_NAMES: Record<string, { name: string; role: DemoRole }> = {
  [ACCOUNTS.admin]: { name: "RugDealer platform", role: "platform" },
  [ACCOUNTS.issuer]: { name: "Test USDC issuer", role: "issuer" },
  [ACCOUNTS.store]: { name: "Kaya Rug House", role: "store" },
  [ACCOUNTS.store2]: { name: "Bazaar Corner Rugs", role: "store" },
  [ACCOUNTS.weaver]: { name: "Ayşe the weaver", role: "weaver" },
  [ACCOUNTS.investor]: { name: "Deniz the investor", role: "investor" },
};

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const accountUrl = (address: string) =>
  address.startsWith("C") ? `${EXPLORER_URL}/contract/${address}` : `${EXPLORER_URL}/account/${address}`;
export const contractUrl = `${EXPLORER_URL}/contract/${CONTRACT_ID}`;
