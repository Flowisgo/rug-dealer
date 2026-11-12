import deployment from "./deployment-data.json";
// Public testnet deployment data. Mirrors docs/testnet-deployment.json.
// Nothing secret lives here: only public keys, contract IDs and parameters.

export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";
export const EXPLORER_URL = "https://stellar.expert/explorer/testnet";

export const CONTRACT_ID = deployment.contract;
export const USDC_ID = deployment.usdc;
export const USDC_CODE = deployment.usdc_code;
export const USDC_ISSUER = deployment.usdc_issuer;
export const DEPLOY_LEDGER = deployment.deploy_ledger;
export const ACCOUNTS = deployment.accounts;
export const HAS_STORE_INDEX = deployment.store_index;

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
