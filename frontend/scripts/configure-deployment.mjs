// The deployment manifest is the only source of public deployment identities.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Asset, StrKey } from "@stellar/stellar-sdk";
const path = process.env.RUGDEALER_MANIFEST
  ? resolve(process.env.RUGDEALER_MANIFEST)
  : fileURLToPath(
      new URL("../../docs/testnet-deployment.json", import.meta.url),
    );
const m = JSON.parse(readFileSync(path, "utf8"));
const passphrase = "Test SDF Network ; September 2015";
if (
  m.network !== "testnet" ||
  !StrKey.isValidContract(m.contract) ||
  !StrKey.isValidContract(m.usdc) ||
  !Number.isSafeInteger(m.deploy_ledger) ||
  m.deploy_ledger <= 0
)
  throw new Error("Invalid Testnet contract or deployment ledger in manifest");
const [code, issuer] = m.usdc_asset.split(":");
if (
  code !== "USDC" ||
  issuer !== m.usdc_issuer ||
  !StrKey.isValidEd25519PublicKey(issuer) ||
  new Asset(code, issuer).contractId(passphrase) !== m.usdc
)
  throw new Error("USDC asset, issuer and SAC do not agree");
const accounts = {};
for (const role of [
  "admin",
  "issuer",
  "store",
  "store2",
  "weaver",
  "investor",
]) {
  const address = m.accounts[role];
  if (!StrKey.isValidEd25519PublicKey(address))
    throw new Error(`Invalid demo account: ${role}`);
  accounts[role] = address;
}
if (accounts.issuer !== issuer)
  throw new Error("Issuer account does not match the asset");
const data = {
  contract: m.contract,
  usdc: m.usdc,
  usdc_issuer: issuer,
  usdc_code: code,
  deploy_ledger: m.deploy_ledger,
  accounts,
  store_index: m.features?.store_index === true,
};
writeFileSync(
  new URL("../lib/deployment-data.json", import.meta.url),
  JSON.stringify(data, null, 2) + "\n",
);
console.log(`Configured frontend from ${path} (${m.contract})`);
