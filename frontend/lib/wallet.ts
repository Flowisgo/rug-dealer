// Varial wallet: connect, testnet check, sign transactions and auth entries.
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

/** True when Varial is set to Stellar Testnet. */
export async function onTestnet(): Promise<boolean> {
  const n = await getNetworkDetails();
  return !n.error && n.networkPassphrase === NETWORK_PASSPHRASE;
}

/** Ask Varial for access. Returns the selected account. */
export async function connect(): Promise<string> {
  if (!(await freighterInstalled()))
    throw fail("Varial isn't available in this browser. Open the app in Chrome with the Varial extension.");
  const access = await requestAccess();
  if (access.error || !access.address) throw fail(access.error?.message || "Connection was declined in Varial.");
  if (!(await onTestnet())) throw fail("Varial is not on Testnet. Switch the network to Testnet in Varial.");
  return access.address;
}

/** The account Varial has selected, if this site is already allowed. */
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

/** Make sure Varial is on testnet and has `expected` selected. */
export async function assertSigner(expected: string): Promise<void> {
  if (!(await freighterInstalled())) throw fail("Varial isn't available in this browser.");
  if (!(await onTestnet())) throw fail("Varial is not on Testnet. Switch the network to Testnet in Varial.");
  const r = await getAddress();
  if (r.error || !r.address) throw fail("Unlock Varial and connect again.");
  if (r.address !== expected) throw fail(`Varial has a different account selected. Switch to ${short(expected)} and try again.`);
}

export async function signTx(txXdr: string, address: string): Promise<string> {
  const r = await signTransaction(txXdr, { networkPassphrase: NETWORK_PASSPHRASE, address });
  if (r.error || !r.signedTxXdr) throw fail(r.error?.message || "You declined to sign. Nothing was sent.");
  if (r.signerAddress && r.signerAddress !== address) throw fail("A different account signed. Nothing was sent.");
  return r.signedTxXdr;
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Sign a Soroban auth-entry preimage (base64 XDR). Varial returns the
 * ed25519 signature over its hash. */
export async function signAuth(preimageXdr: string, address: string): Promise<{ signature: Uint8Array; publicKey: string }> {
  const r = await signAuthEntry(preimageXdr, { networkPassphrase: NETWORK_PASSPHRASE, address });
  if (r.error || !r.signedAuthEntry) throw fail(r.error?.message || "You declined to sign. Nothing was sent.");
  return { signature: fromBase64(r.signedAuthEntry), publicKey: r.signerAddress || address };
}

export { short } from "./names";
