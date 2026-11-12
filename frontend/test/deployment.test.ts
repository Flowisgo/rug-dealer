import { expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import manifest from "../../docs/testnet-deployment.json";
it("generates every public identity from a selected deployment manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "rug-config-"));
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "lib"));
    cpSync(
      "scripts/sync-deployment.mjs",
      join(dir, "scripts/sync-deployment.mjs"),
    );
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
    const selected = {
      ...manifest,
      contract: manifest.usdc,
      deploy_ledger: 123456,
      accounts: { ...manifest.accounts, store: manifest.accounts.investor },
      features: { store_index: true },
    };
    const path = join(dir, "manifest.json");
    writeFileSync(path, JSON.stringify(selected));
    execFileSync(process.execPath, [join(dir, "scripts/sync-deployment.mjs")], {
      env: { ...process.env, RUGDEALER_MANIFEST: path },
    });
    expect(
      JSON.parse(readFileSync(join(dir, "lib/deployment.json"), "utf8")),
    ).toMatchObject({
      contract: selected.contract,
      usdc: selected.usdc,
      usdcCode: "USDC",
      usdcIssuer: selected.usdc_issuer,
      accounts: selected.accounts,
      deployLedger: 123456,
      storeIndex: true,
    });
    writeFileSync(
      path,
      JSON.stringify({ ...selected, usdc: selected.accounts.admin }),
    );
    expect(() =>
      execFileSync(
        process.execPath,
        [join(dir, "scripts/sync-deployment.mjs")],
        { env: { ...process.env, RUGDEALER_MANIFEST: path }, stdio: "pipe" },
      ),
    ).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
