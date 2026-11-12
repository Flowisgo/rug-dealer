#!/usr/bin/env python3
"""Deploy RugDealer to Stellar testnet and run the demo scenarios.

Secrets stay in the Stellar CLI config directory outside this repository.
The script writes only public data to docs/testnet-deployment.json and
docs/testnet-demo-results.json.

Usage:
    python scripts/testnet.py deploy
    python scripts/testnet.py demo --scenario all
    python scripts/testnet.py status

Requirements: Stellar CLI 30.x, Python 3.10+.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="replace")
    sys.stderr.reconfigure(errors="replace")

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATE = Path.home() / ".rugdealer-demo"
STATE = Path(os.environ.get("RUGDEALER_STATE", DEFAULT_STATE)).expanduser().resolve()
CONFIG = STATE / "config"
LOGS = STATE / "logs"
MANIFEST = ROOT / "docs" / "testnet-deployment.json"
RESULTS = ROOT / "docs" / "testnet-demo-results.json"
HORIZON = "https://horizon-testnet.stellar.org"
FRIENDBOT = "https://friendbot.stellar.org"
CLI = os.environ.get("STELLAR_CLI", "stellar")
UNIT = 10_000_000  # 7 decimals
ALIASES = {
    "admin": "rd-admin",
    "issuer": "rd-issuer",
    "store": "rd-store",
    "store2": "rd-store2",
    "weaver": "rd-weaver",
    "investor": "rd-investor",
}
ROLES = list(ALIASES)
TRUST_ROLES = ["admin", "store", "store2", "weaver", "investor"]

TX_LOG: list[dict[str, Any]] = []


@dataclass
class CliResult:
    stdout: str
    stderr: str
    hashes: list[str]
    command: list[str]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_state() -> None:
    if STATE == ROOT or ROOT in STATE.parents:
        raise SystemExit(
            f"RUGDEALER_STATE must be outside the repository (got {STATE})."
        )
    for path in (STATE, CONFIG, LOGS):
        path.mkdir(parents=True, exist_ok=True)


def safe_label(label: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", label).strip("-") or "command"


def last_line(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[-1] if lines else ""


def first_match(text: str, pattern: str) -> str | None:
    matches = re.findall(pattern, text)
    return matches[-1] if matches else None


def parse_json_last(result: CliResult) -> Any:
    line = last_line(result.stdout)
    try:
        return json.loads(line)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"expected JSON from {result.command[-1]}, got:\n{result.stdout[-2000:]}"
        ) from exc


def run_cli(label: str, args: list[str], timeout: int = 300, check: bool = True) -> CliResult:
    ensure_state()
    command = [CLI, "--config-dir", str(CONFIG), "--no-cache"] + args
    env = os.environ.copy()
    env.setdefault("NO_COLOR", "1")
    try:
        proc = subprocess.run(
            command,
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
        )
    except FileNotFoundError as exc:
        raise SystemExit(f"Stellar CLI not found: {CLI}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{label} timed out after {timeout}s") from exc

    output = proc.stdout + "\n" + proc.stderr
    log_path = LOGS / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{safe_label(label)}.log"
    log_path.write_text(f"$ {command}\n\n{output}", encoding="utf-8")
    hashes = re.findall(r"Signing transaction: ([0-9a-f]{64})", output)
    if hashes:
        TX_LOG.append(
            {
                "action": label,
                "hashes": hashes,
                "command": ["stellar", *args],
            }
        )
    if check and proc.returncode != 0:
        tail = (proc.stderr or proc.stdout)[-3000:]
        raise RuntimeError(f"{label} failed (exit {proc.returncode}):\n{tail}")
    return CliResult(proc.stdout, proc.stderr, hashes, command)


def view(contract: str, function: str, args: list[str], source: str = "rd-admin") -> Any:
    result = run_cli(
        f"view-{function}",
        [
            "contract",
            "invoke",
            "--id",
            contract,
            "--source",
            source,
            "--network",
            "testnet",
            "--send=no",
            "--",
            function,
            *args,
        ],
    )
    return parse_json_last(result)


def send(
    contract: str,
    source: str,
    function: str,
    args: list[str],
    label: str | None = None,
) -> str:
    result = run_cli(
        label or function,
        [
            "contract",
            "invoke",
            "--id",
            contract,
            "--source",
            source,
            "--network",
            "testnet",
            "--",
            function,
            *args,
        ],
    )
    return last_line(result.stdout)


def http_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "rugdealer-demo/1.0"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)


def horizon_account(address: str) -> dict[str, Any] | None:
    try:
        return http_json(f"{HORIZON}/accounts/{address}")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def transaction_ledger(tx_hash: str) -> int:
    for attempt in range(15):
        try:
            tx = http_json(f"{HORIZON}/transactions/{tx_hash}")
            return int(tx["ledger"])
        except urllib.error.HTTPError as exc:
            if exc.code != 404 or attempt == 14:
                raise
            time.sleep(1)
    raise RuntimeError(f"transaction {tx_hash} not found on Horizon")


def wait_for_account(address: str) -> None:
    for _ in range(20):
        if horizon_account(address):
            return
        time.sleep(1)
    raise RuntimeError(f"account {address} did not appear on testnet")


def friendbot(address: str) -> None:
    for attempt in range(5):
        try:
            http_json(f"{FRIENDBOT}/?addr={address}")
            wait_for_account(address)
            return
        except urllib.error.HTTPError as exc:
            if exc.code == 400 and horizon_account(address):
                return
            if attempt == 4:
                raise
            time.sleep(2)


def key_address(alias: str) -> str:
    result = run_cli(f"address-{alias}", ["keys", "address", alias])
    address = first_match(result.stdout, r"G[A-Z2-7]{55}")
    if not address:
        raise RuntimeError(f"could not read address for {alias}:\n{result.stdout}")
    return address


def ensure_accounts() -> dict[str, str]:
    accounts: dict[str, str] = {}
    for role in ROLES:
        alias = ALIASES[role]
        identity = CONFIG / "identity" / f"{alias}.toml"
        if not identity.exists():
            run_cli(f"create-{role}", ["keys", "generate", alias], timeout=120)
        address = key_address(alias)
        if not horizon_account(address):
            friendbot(address)
        accounts[role] = address
    return accounts


def has_trustline(address: str, issuer: str) -> bool:
    account = horizon_account(address)
    if not account:
        return False
    return any(
        balance.get("asset_code") == "USDC"
        and balance.get("asset_issuer") == issuer
        and balance.get("is_authorized", True)
        for balance in account.get("balances", [])
    )


def ensure_trustline(role: str, issuer: str, accounts: dict[str, str]) -> None:
    address = accounts[role]
    if has_trustline(address, issuer):
        return
    run_cli(
        f"trust-{role}",
        [
            "tx",
            "new",
            "change-trust",
            "--source",
            ALIASES[role],
            "--network",
            "testnet",
            "--line",
            f"USDC:{issuer}",
        ],
    )
    for _ in range(20):
        if has_trustline(address, issuer):
            return
        time.sleep(1)
    raise RuntimeError(f"trustline for {role} was not visible on Horizon")


def usdc_balance(usdc: str, address: str) -> int:
    value = view(usdc, "balance", ["--id", address])
    return int(value)


def ensure_usdc(
    role: str,
    amount: int,
    accounts: dict[str, str],
    usdc: str,
    issuer: str,
) -> None:
    if amount <= 0:
        return
    ensure_trustline(role, issuer, accounts)
    before = usdc_balance(usdc, accounts[role])
    send(
        usdc,
        ALIASES["issuer"],
        "mint",
        ["--to", accounts[role], "--amount", str(amount)],
        label=f"mint-usdc-{role}",
    )
    for _ in range(20):
        if usdc_balance(usdc, accounts[role]) >= before + amount:
            return
        time.sleep(1)
    raise RuntimeError(f"USDC mint to {role} was not visible")


def build_wasm() -> Path:
    run_cli("build", ["contract", "build"], timeout=900)
    wasm = ROOT / "target" / "wasm32v1-none" / "release" / "rugdealer.wasm"
    if not wasm.exists():
        raise RuntimeError(f"wasm not found at {wasm}")
    return wasm


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def load_manifest() -> dict[str, Any]:
    if not MANIFEST.exists():
        raise SystemExit(f"no deployment manifest at {MANIFEST}; run deploy first")
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def deploy(args: argparse.Namespace) -> None:
    ensure_state()
    TX_LOG.clear()
    accounts = ensure_accounts()
    wasm = build_wasm()
    issuer = accounts["issuer"]
    asset = f"USDC:{issuer}"

    id_result = run_cli(
        "usdc-id",
        ["contract", "id", "asset", "--asset", asset, "--network", "testnet"],
    )
    usdc = first_match(id_result.stdout, r"C[A-Z2-7]{55}")
    if not usdc:
        raise RuntimeError(f"could not derive USDC SAC id:\n{id_result.stdout}")

    try:
        run_cli(
            "deploy-usdc",
            [
                "contract",
                "asset",
                "deploy",
                "--asset",
                asset,
                "--source",
                ALIASES["issuer"],
                "--network",
                "testnet",
                "--alias",
                "rd-usdc",
            ],
        )
    except RuntimeError as exc:
        text = str(exc)
        if "contract already exists" not in text and "ExistingValue" not in text:
            raise

    funding = {
        "admin": 1_000 * UNIT,
        "store": 10_000 * UNIT,
        "store2": 1_000 * UNIT,
        "weaver": 10_000 * UNIT,
        "investor": 10_000 * UNIT,
    }
    for role in TRUST_ROLES:
        ensure_usdc(role, funding[role], accounts, usdc, issuer)

    store_limit = args.store_limit * UNIT
    rug_price = args.rug_price * UNIT
    constructor_args = [
        "--admin",
        accounts["admin"],
        "--usdc",
        usdc,
        "--fee_recipient",
        accounts["admin"],
        "--interest_bps_per_year",
        str(args.interest_bps),
        "--platform_fee_bps",
        str(args.platform_bps),
        "--store_fee_bps_per_month",
        str(args.store_bps),
        "--max_months",
        str(args.max_months),
        "--month_seconds",
        str(args.month_seconds),
        "--buyout_window_seconds",
        str(args.window_seconds),
    ]
    deploy_result = run_cli(
        "deploy-contract",
        [
            "contract",
            "deploy",
            "--wasm",
            str(wasm),
            "--source",
            ALIASES["admin"],
            "--network",
            "testnet",
            "--",
            *constructor_args,
        ],
    )
    contract = first_match(deploy_result.stdout, r"C[A-Z2-7]{55}")
    if not contract:
        raise RuntimeError(f"could not read contract id:\n{deploy_result.stdout}")

    for role in ("store", "store2"):
        send(
            contract,
            ALIASES["admin"],
            "register_store",
            ["--store", accounts[role], "--limit", str(store_limit)],
            label=f"register-{role}",
        )

    deploy_entry = next(
        (entry for entry in reversed(TX_LOG) if entry["action"] == "deploy-contract"),
        None,
    )
    deploy_hash = deploy_entry["hashes"][-1] if deploy_entry and deploy_entry["hashes"] else None
    deploy_ledger = transaction_ledger(deploy_hash) if deploy_hash else None

    manifest = {
        "network": "testnet",
        "deployed_at": utc_now(),
        "contract": contract,
        "deploy_tx_hash": deploy_hash,
        "deploy_ledger": deploy_ledger,
        "usdc": usdc,
        "usdc_asset": asset,
        "usdc_issuer": issuer,
        "accounts": accounts,
        "params": {
            "interest_bps_per_year": args.interest_bps,
            "platform_fee_bps": args.platform_bps,
            "store_fee_bps_per_month": args.store_bps,
            "max_months": args.max_months,
            "month_seconds": args.month_seconds,
            "buyout_window_seconds": args.window_seconds,
            "store_limit": store_limit,
            "rug_price": rug_price,
        },
        "wasm_sha256": hashlib.sha256(wasm.read_bytes()).hexdigest(),
        "transactions": TX_LOG.copy(),
    }
    write_json(MANIFEST, manifest)

    print("\nDeployment complete")
    print(f"  contract:    {contract}")
    print(f"  deploy ledger: {deploy_ledger}")
    print(f"  USDC SAC:    {usdc}")
    print(f"  USDC asset:  {asset}")
    for role in ROLES:
        print(f"  {role:<10} {accounts[role]}")
    print(f"  manifest:    {MANIFEST}")
    print(f"  state keys:  {STATE} (outside the repository)")
    print("\nNext: python scripts/testnet.py demo --scenario all")


def wait_until(timestamp: int, label: str) -> None:
    while True:
        remaining = timestamp - int(time.time())
        if remaining <= 0:
            return
        print(f"  waiting {remaining:>3}s for {label}...", flush=True)
        time.sleep(min(5, remaining))


def quote_for(params: dict[str, Any], principal: int, months: int) -> dict[str, int]:
    interest = (
        principal * int(params["interest_bps_per_year"]) * months
    ) // (10_000 * 12)
    platform_fee = (principal * int(params["platform_fee_bps"])) // 10_000
    store_fee = (
        principal * int(params["store_fee_bps_per_month"]) * months
    ) // 10_000
    weaver_payout = principal - interest - platform_fee - store_fee
    return {
        "interest": interest,
        "platform_fee": platform_fee,
        "store_fee": store_fee,
        "weaver_payout": weaver_payout,
        "investor_payout": principal + interest,
    }


def balance_snapshot(manifest: dict[str, Any], roles: list[str]) -> dict[str, int]:
    usdc = manifest["usdc"]
    snapshot = {
        role: usdc_balance(usdc, manifest["accounts"][role])
        for role in roles
        if role != "issuer"
    }
    snapshot["contract"] = usdc_balance(usdc, manifest["contract"])
    return snapshot


def run_scenario(manifest: dict[str, Any], name: str) -> dict[str, Any]:
    contract = manifest["contract"]
    accounts = manifest["accounts"]
    params = manifest["params"]
    usdc = manifest["usdc"]
    price = int(params["rug_price"])
    months = 6 if name == "repay" else 1
    store_role = "store2" if name == "claim" else "store"
    store_address = accounts[store_role]
    store_source = ALIASES[store_role]

    store = view(contract, "get_store", ["--store", store_address])
    if store["frozen"]:
        raise RuntimeError(
            f"{store_role} is frozen in this deployment; redeploy before running {name}"
        )

    print(f"\n[{name}] store={store_role} months={months} price={price / UNIT:g} USDC")
    description = f"RugDealer demo - {name}"
    rug_id = int(
        send(
            contract,
            store_source,
            "mint_rug",
            [
                "--store",
                store_address,
                "--weaver",
                accounts["weaver"],
                "--description",
                description,
                "--price",
                str(price),
            ],
            label=f"mint-rug-{name}",
        )
    )
    loan_id = int(
        send(
            contract,
            ALIASES["weaver"],
            "request_loan",
            [
                "--weaver",
                accounts["weaver"],
                "--rug_id",
                str(rug_id),
                "--months",
                str(months),
            ],
            label=f"request-{name}",
        )
    )
    print(f"  rug_id={rug_id} loan_id={loan_id}")

    before = balance_snapshot(manifest, ROLES)
    start = len(TX_LOG)
    send(
        contract,
        ALIASES["investor"],
        "fund_loan",
        ["--investor", accounts["investor"], "--loan_id", str(loan_id)],
        label=f"fund-{name}",
    )

    if name == "repay":
        send(
            contract,
            ALIASES["weaver"],
            "repay",
            ["--loan_id", str(loan_id)],
            label=f"repay-{name}",
        )
    elif name == "buyout":
        loan = view(contract, "get_loan", ["--loan_id", str(loan_id)])
        wait_until(int(loan["end_at"]) + 2, "buy-out window")
        send(
            contract,
            store_source,
            "store_buyout",
            ["--loan_id", str(loan_id)],
            label=f"store-buyout-{name}",
        )
    elif name == "claim":
        loan = view(contract, "get_loan", ["--loan_id", str(loan_id)])
        window = int(params["buyout_window_seconds"])
        wait_until(int(loan["end_at"]) + window + 2, "claim window")
        send(
            contract,
            ALIASES["investor"],
            "claim_rug",
            ["--loan_id", str(loan_id)],
            label=f"claim-{name}",
        )
    else:
        raise RuntimeError(f"unknown scenario {name}")

    after = balance_snapshot(manifest, ROLES)
    deltas = {role: after[role] - before[role] for role in before}
    quote = quote_for(params, price, months)

    expected = {role: 0 for role in before}
    expected["investor"] = quote["interest"]
    if name == "claim":
        expected["investor"] -= price
    expected["admin"] = quote["platform_fee"]
    expected[store_role] = quote["store_fee"]
    expected["weaver"] = (
        -(quote["interest"] + quote["platform_fee"] + quote["store_fee"])
        if name == "repay"
        else quote["weaver_payout"]
    )
    if name == "buyout":
        expected[store_role] -= price

    if deltas != expected:
        raise RuntimeError(
            f"{name} balance mismatch:\n  expected {expected}\n  actual   {deltas}"
        )

    loan = view(contract, "get_loan", ["--loan_id", str(loan_id)])
    rug = view(contract, "get_rug", ["--rug_id", str(rug_id)])
    store_after = view(contract, "get_store", ["--store", store_address])
    expected_status = {"repay": "Repaid", "buyout": "BoughtOut", "claim": "Claimed"}[name]
    expected_owner = {
        "repay": accounts["weaver"],
        "buyout": store_address,
        "claim": accounts["investor"],
    }[name]
    if loan["status"] != expected_status:
        raise RuntimeError(f"{name}: loan status {loan['status']} != {expected_status}")
    if rug["owner"] != expected_owner:
        raise RuntimeError(f"{name}: rug owner {rug['owner']} != {expected_owner}")
    if rug["status"] != "Free":
        raise RuntimeError(f"{name}: rug status {rug['status']} != Free")
    if int(store_after["open_principal"]) != 0:
        raise RuntimeError(f"{name}: store principal was not released")
    if name == "claim" and not store_after["frozen"]:
        raise RuntimeError("claim did not freeze the store")

    result = {
        "scenario": name,
        "store_role": store_role,
        "store": store_address,
        "rug_id": rug_id,
        "loan_id": loan_id,
        "months": months,
        "principal": price,
        "quote": quote,
        "before": before,
        "after": after,
        "deltas": deltas,
        "loan_status": loan["status"],
        "rug_owner": rug["owner"],
        "rug_status": rug["status"],
        "store_frozen": store_after["frozen"],
        "store_open_principal": int(store_after["open_principal"]),
        "transactions": TX_LOG[start:],
    }
    print(
        f"  OK {name}: {expected_status}, owner {expected_owner[:8]}..., "
        f"investor {expected['investor'] / UNIT:+g} USDC"
    )
    return result


def demo(args: argparse.Namespace) -> None:
    ensure_state()
    TX_LOG.clear()
    manifest = load_manifest()
    scenarios = (
        ["repay", "buyout", "claim"] if args.scenario == "all" else [args.scenario]
    )

    config = view(manifest["contract"], "get_config", [])
    expected_params = manifest["params"]
    for key in (
        "interest_bps_per_year",
        "platform_fee_bps",
        "store_fee_bps_per_month",
        "max_months",
        "month_seconds",
        "buyout_window_seconds",
    ):
        if int(config[key]) != int(expected_params[key]):
            raise RuntimeError(
                f"config mismatch for {key}: {config[key]} != {expected_params[key]}"
            )

    results = []
    for name in scenarios:
        results.append(run_scenario(manifest, name))

    output = {
        "network": "testnet",
        "generated_at": utc_now(),
        "contract": manifest["contract"],
        "usdc": manifest["usdc"],
        "params": manifest["params"],
        "accounts": manifest["accounts"],
        "scenarios": results,
    }
    write_json(RESULTS, output)

    print("\nDemo complete")
    for result in results:
        print(
            f"  {result['scenario']:<7} loan {result['loan_id']}  "
            f"rug {result['rug_id']}  {result['loan_status']}"
        )
    print(f"  results: {RESULTS}")
    print("  main store remains active; store2 is frozen only by the claim scenario")


def status(_args: argparse.Namespace) -> None:
    manifest = load_manifest()
    config = view(manifest["contract"], "get_config", [])
    stores = {
        role: view(manifest["contract"], "get_store", ["--store", manifest["accounts"][role]])
        for role in ("store", "store2")
    }
    print(
        json.dumps(
            {
                "network": manifest["network"],
                "deployed_at": manifest["deployed_at"],
                "contract": manifest["contract"],
                "usdc": manifest["usdc"],
                "accounts": manifest["accounts"],
                "params": manifest["params"],
                "config": config,
                "stores": stores,
            },
            indent=2,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    deploy_parser = sub.add_parser("deploy", help="deploy a fresh testnet instance")
    deploy_parser.add_argument("--interest-bps", type=int, default=1500)
    deploy_parser.add_argument("--platform-bps", type=int, default=100)
    deploy_parser.add_argument("--store-bps", type=int, default=25)
    deploy_parser.add_argument("--max-months", type=int, default=12)
    deploy_parser.add_argument("--month-seconds", type=int, default=60)
    deploy_parser.add_argument("--window-seconds", type=int, default=60)
    deploy_parser.add_argument("--store-limit", type=int, default=5_000)
    deploy_parser.add_argument("--rug-price", type=int, default=600)

    demo_parser = sub.add_parser("demo", help="run the repayment, buy-out, or claim demo")
    demo_parser.add_argument(
        "--scenario", choices=["repay", "buyout", "claim", "all"], default="all"
    )

    sub.add_parser("status", help="print the deployment and current store state")

    args = parser.parse_args()
    if args.command == "deploy":
        deploy(args)
    elif args.command == "demo":
        demo(args)
    elif args.command == "status":
        status(args)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, urllib.error.URLError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
