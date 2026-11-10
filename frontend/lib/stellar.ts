import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Networks,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  getAddress,
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";

export const CONTRACT =
  "CCRIC7GAMNO3MADK5VIDG7PB7XCJBGMJDC2PNPCMBC5CW6SJU66T6YEF";
export const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const DEMO_RECEIPT =
  "a7fda59407b719206fc2afa87afb91069f2370b9629aabcb78e1a5948e9de703";
const READER = "GALBTMOQLGDYANDGXIHXGZHLALE3C3BYO43C3NYORGWRR34PL44465DQ";
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
export const txLink = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const storageKey = (receipt: string) =>
  `${CONTRACT}:${receipt}:purchase`;
export type Receipt = {
  weaver: string;
  lender: string | null;
  buyer: string | null;
  approved_price: bigint | null;
  stage: string;
  ready_for_pickup: boolean;
};
export type Terms = {
  advance: bigint;
  lender_due: bigint;
  custody_fee: bigint;
};
export type Purchase = {
  hash: string;
  status: "pending" | "confirmed" | "failed";
};
export const units = (value: bigint) => {
  const whole = value / 10_000_000n;
  const fraction = (value % 10_000_000n)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
};
export function receiptBytes(id: string) {
  if (!/^[0-9a-f]{64}$/i.test(id))
    throw new Error("Use a receipt ID with exactly 64 hexadecimal characters.");
  return nativeToScVal(
    Uint8Array.from(id.match(/../g)!.map((byte) => parseInt(byte, 16))),
    { type: "bytes" },
  );
}
async function view(contract: string, method: string, args: xdr.ScVal[] = []) {
  const tx = new TransactionBuilder(new Account(READER, "0"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(contract).call(method, ...args))
    .setTimeout(60)
    .build();
  const result = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(result) || !result.result)
    throw new Error(
      "Could not read this receipt on Stellar testnet. Check the receipt ID and try again.",
    );
  return scValToNative(result.result.retval);
}
export async function readReceipt(id: string): Promise<Receipt> {
  const value = await view(CONTRACT, "get_receipt", [receiptBytes(id)]);
  return {
    ...value,
    stage: Array.isArray(value.stage) ? value.stage[0] : value.stage,
  };
}
export const readTerms = async (): Promise<Terms> =>
  view(CONTRACT, "loan_terms");
export const readBalance = async (address: string): Promise<bigint> =>
  view(USDC, "balance", [new Address(address).toScVal()]);
export async function verifyWallet(address?: string) {
  const network = await getNetworkDetails();
  if (network.error) throw new Error(network.error.message);
  if (network.networkPassphrase !== Networks.TESTNET)
    throw new Error(
      "Switch Freighter to Testnet, then connect again. This page never uses mainnet.",
    );
  const current = await getAddress();
  if (current.error || !current.address)
    throw new Error(
      "Freighter is locked or disconnected. Connect your wallet again.",
    );
  if (address && address !== current.address)
    throw new Error(
      "Your Freighter account changed. Connect again to review the new buyer wallet.",
    );
  return current.address;
}
export async function connectWallet() {
  if (!(await isConnected()).isConnected)
    throw new Error(
      "Freighter is not available in this browser. Install the Freighter extension, set it to Testnet, and try again.",
    );
  const result = await requestAccess();
  if (result.error || !result.address)
    throw new Error(result.error?.message || "Wallet connection was declined.");
  return verifyWallet(result.address);
}
export async function purchaseRug(
  id: string,
  buyer: string,
  reviewedPrice: bigint,
  onStep: (message: string) => void,
): Promise<string> {
  await verifyWallet(buyer);
  const receipt = await readReceipt(id);
  if (receipt.stage !== "Active" || receipt.ready_for_pickup)
    throw new Error("This rug is no longer available. Refresh the receipt.");
  if (receipt.approved_price !== reviewedPrice)
    throw new Error(
      "The approved price changed. Refresh the receipt and review the new price before signing.",
    );
  if ((await readBalance(buyer)) < reviewedPrice)
    throw new Error(
      "Your wallet does not have enough test USDC for this purchase.",
    );
  onStep("Preparing your purchase…");
  const account = await server.getAccount(buyer);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(CONTRACT).call(
        "buy",
        receiptBytes(id),
        new Address(buyer).toScVal(),
        nativeToScVal(reviewedPrice, { type: "i128" }),
      ),
    )
    .setTimeout(180)
    .build();
  // Preserve the simulation's complete Soroban authorization tree and resource data.
  const prepared = await server.prepareTransaction(tx);
  await verifyWallet(buyer);
  onStep("Review and sign in Freighter…");
  const result = await signTransaction(prepared.toXDR(), {
    networkPassphrase: Networks.TESTNET,
    address: buyer,
  });
  if (result.error || !result.signedTxXdr)
    throw new Error(
      result.error?.message ||
        "Purchase signature was declined. No transaction was submitted.",
    );
  if (result.signerAddress !== buyer)
    throw new Error("The signing wallet does not match the connected buyer.");
  const signed = TransactionBuilder.fromXDR(
    result.signedTxXdr,
    Networks.TESTNET,
  );
  if (
    !(signed instanceof Transaction) ||
    hex(signed.hash()) !== hex(prepared.hash())
  )
    throw new Error(
      "The signed transaction does not match the purchase you reviewed.",
    );
  // Persist before submission: a timeout must not invite a second purchase attempt.
  const hash = hex(signed.hash());
  localStorage.setItem(
    storageKey(id),
    JSON.stringify({ hash, status: "pending" }),
  );
  onStep("Submitting to Stellar testnet…");
  const sent = await server.sendTransaction(signed);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    localStorage.removeItem(storageKey(id));
    throw new Error(
      "The network did not accept this transaction. Refresh the receipt before trying again.",
    );
  }
  return hash;
}
export async function awaitConfirmation(
  hash: string,
): Promise<"confirmed" | "failed" | "pending"> {
  for (let i = 0; i < 40; i++) {
    const result = await server.getTransaction(hash);
    if (result.status === "SUCCESS") return "confirmed";
    if (result.status === "FAILED") return "failed";
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return "pending";
}
