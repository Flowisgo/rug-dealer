import { expect, it } from "vitest";
import {
  Account,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  rpc,
} from "@stellar/stellar-sdk";
import { addr, i128, server, usdcBalance, getRug } from "../lib/contract";
import { ACCOUNTS, USDC_ID, NETWORK_PASSPHRASE } from "../lib/deployment";
import { explainError } from "../lib/errors";
// Unsigned simulations only. Never sign or send this intentionally invalid transfer.
it("attributes live SAC insufficient funds to USDC, preserving real missing-rug errors", async () => {
  const balance = await usdcBalance(ACCOUNTS.investor);
  expect(balance).not.toBeNull();
  const tx = new TransactionBuilder(new Account(ACCOUNTS.investor, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: USDC_ID,
        function: "transfer",
        args: [
          addr(ACCOUNTS.investor),
          addr(ACCOUNTS.weaver),
          i128(balance! + 1n),
        ],
        auth: [],
      }),
    )
    .setTimeout(30)
    .build();
  const result = await server().simulateTransaction(tx);
  expect(rpc.Api.isSimulationError(result)).toBe(true);
  if (!rpc.Api.isSimulationError(result))
    throw new Error("Expected insufficient funds");
  expect(explainError(result.error, result.events, USDC_ID)).toMatchObject({
    source: "usdc",
    code: 10,
  });
  await expect(getRug(18446744073709551615n)).rejects.toMatchObject({
    source: "rugdealer",
    code: 10,
  });
});
