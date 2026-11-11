// Read-only integration check: exercise the website's actual term/receipt encoding.
import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  Account,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
  Address,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import deployment from "../demo/deployment.json" with { type: "json" };
import { receiptBytes, termsValue } from "../lib/encoding.ts";
const CONTRACT = deployment.contract;
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const addressValue = (a) => new Address(a).toScVal();
async function view(method, args = []) {
  const tx = new TransactionBuilder(
    new Account(deployment.accounts.warehouse, "0"),
    { fee: BASE_FEE, networkPassphrase: Networks.TESTNET },
  )
    .addOperation(new Contract(CONTRACT).call(method, ...args))
    .setTimeout(60)
    .build();
  const result = await server.simulateTransaction(tx);
  assert(rpc.Api.isSimulationSuccess(result));
  return scValToNative(result.result.retval);
}
const readReceipt = (id) => view("get_receipt", [receiptBytes(id)]);
const readDefaults = () => view("loan_terms");
const id = process.argv[2];
if (!id) throw new Error("Usage: node scripts/rpc-smoke.mjs HELD_RECEIPT_ID");
const receipt = await readReceipt(id);
const stage = receipt.stage[0];
const defaults = await readDefaults();
const terms =
  receipt.terms[0] === "Accepted"
    ? receipt.terms[1]
    : {
        ...defaults,
        lender: deployment.accounts.lender,
        dealer: deployment.accounts.dealer,
      };
const checks = [];
const operations = [
  [
    "register_receipt",
    deployment.accounts.warehouse,
    [
      receiptBytes(randomBytes(32).toString("hex")),
      addressValue(deployment.accounts.weaver),
    ],
  ],
];
if (stage === "Held")
  operations.push([
    "accept_terms",
    deployment.accounts.weaver,
    [receiptBytes(id), termsValue(terms)],
  ]);
if (stage === "TermsAccepted" && !receipt.dealer_committed)
  operations.push([
    "accept_fallback",
    terms.dealer,
    [receiptBytes(id), termsValue(terms)],
  ]);
if (stage === "TermsAccepted" && receipt.dealer_committed)
  operations.push(["fund_loan", terms.lender, [receiptBytes(id)]]);
if (stage === "Active")
  operations.push(
    [
      "approve_sale",
      receipt.weaver,
      [receiptBytes(id), nativeToScVal(150000000n, { type: "i128" })],
    ],
    ["repay", receipt.weaver, [receiptBytes(id)]],
  );
if (stage === "Active" && receipt.approved_price != null)
  operations.push([
    "buy",
    deployment.accounts.buyer,
    [
      receiptBytes(id),
      addressValue(deployment.accounts.buyer),
      nativeToScVal(receipt.approved_price, { type: "i128" }),
    ],
  ]);
if (stage === "Overdue")
  operations.push(
    ["repay", receipt.weaver, [receiptBytes(id)]],
    ["dealer_buy", terms.dealer, [receiptBytes(id)]],
  );
for (const [method, source, args] of operations) {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(CONTRACT).call(method, ...args))
    .setTimeout(60)
    .build();
  const result = await server.simulateTransaction(tx);
  assert(rpc.Api.isSimulationSuccess(result), JSON.stringify(result));
  const prepared = rpc.assembleTransaction(tx, result).build();
  assert(prepared.toXDR());
  checks.push({
    method,
    source,
    result:
      "simulation succeeded; transaction assembled; no signature or submission",
  });
}
const afterStage = (await readReceipt(id)).stage[0];
assert(stage === afterStage || (stage === "Active" && afterStage === "Overdue"));
const output = new URL("../../docs/full-demo-rpc-smoke.json", import.meta.url);
let previous = [];
try {
  previous = JSON.parse(await readFile(output, "utf8")).runs || [];
} catch {}
await writeFile(
  output,
  JSON.stringify(
    {
      contract: CONTRACT,
      runs: [...previous, { receipt_id: id, stage, checks }],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "PASS: actual frontend encoding and RPC assembly in " +
    stage +
    "; no signature or submission, receipt state unchanged.",
);
