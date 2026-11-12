// Freighter wallet: connect, testnet check, sign transactions and auth entries.
import {
  getAddress,
  getNetworkDetails,
  isAllowed,
  isConnected,
  requestAccess,
  signAuthEntry,
  signTransaction,
} from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE } from "./deployment";
import { AppError } from "./errors";
import { short } from "./names";

const fail = (message: string) => new AppError(message, undefined, "wallet");

export async function freighterInstalled(): Promise<boolean> {
  try {
    return (await isConnected()).isConnected === true;
  } catch {
    return false;
  }
}

/** True when Freighter is set to Stellar Testnet. */
export async function onTestnet(): Promise<boolean> {
  const n = await getNetworkDetails();
  return !n.error && n.networkPassphrase === NETWORK_PASSPHRASE;
}

/** Ask Freighter for access. Returns the selected account. */
export async function connect(): Promise<string> {
  if (!(await freighterInstalled()))
    throw fail("Freighter isn't available in this browser. Open the app in Chrome with the Freighter extension.");
  const access = await requestAccess();
  if (access.error || !access.address) throw fail(access.error?.message || "Connection was declined in Freighter.");
  if (!(await onTestnet())) throw fail("Freighter is not on Testnet. Switch the network to Testnet in Freighter.");
  return access.address;
}

/** The account Freighter has selected, if this site is already allowed. */
export async function currentAddress(): Promise<string | null> {
  try {
    if (!(await freighterInstalled())) return null;
    if (!(await isAllowed()).isAllowed) return null;
    const r = await getAddress();
    return r.error || !r.address ? null : r.address;
  } catch {
    return null;
  }
}

/** Make sure Freighter is on testnet and has `expected` selected. */
export async function assertSigner(expected: string): Promise<void> {
  if (!(await freighterInstalled())) throw fail("Freighter isn't available in this browser.");
  if (!(await onTestnet())) throw fail("Freighter is not on Testnet. Switch the network to Testnet in Freighter.");
  const r = await getAddress();
  if (r.error || !r.address) throw fail("Unlock Freighter and connect again.");
  if (r.address !== expected) throw fail(`Freighter has a different account selected. Switch to ${short(expected)} and try again.`);
}

export async function signTx(txXdr: string, address: string): Promise<string> {
  const r = await signTransaction(txXdr, { networkPassphrase: NETWORK_PASSPHRASE, address });
  if (r.error || !r.signedTxXdr) throw fail(r.error?.message || "You declined to sign. Nothing was sent.");
  if (r.signerAddress && r.signerAddress !== address) throw fail("A different account signed. Nothing was sent.");
  return r.signedTxXdr;
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Sign a Soroban auth-entry preimage (base64 XDR). Freighter returns the
 * ed25519 signature over its hash. */
export async function signAuth(preimageXdr: string, address: string): Promise<{ signature: Uint8Array; publicKey: string }> {
  const r = await signAuthEntry(preimageXdr, { networkPassphrase: NETWORK_PASSPHRASE, address });
  if (r.error || !r.signedAuthEntry) throw fail(r.error?.message || "You declined to sign. Nothing was sent.");
  return { signature: fromBase64(r.signedAuthEntry), publicKey: r.signerAddress || address };
}

export { short } from "./names";
