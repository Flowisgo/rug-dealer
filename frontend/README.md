# Buyer rug page

A standalone Next.js buyer page, branched from `main` while [contract PR #3](https://github.com/Flowisgo/rug-dealer/pull/3) is under review. This branch changes only `frontend/`; it does not include or change contract code.

## Run

Use Node.js 24 LTS and npm:

```sh
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:3000 in a browser with Freighter. Production checks:

```sh
npm run typecheck
npm run build
npm start
```

No environment variables or private keys are required by the app. All signing happens in Freighter. There is no backend signer, embedded secret, or wallet mock.

## Network and receipt

- Network: Stellar testnet (`Test SDF Network ; September 2015`). Mainnet wallets are rejected.
- Contract: `CCRIC7GAMNO3MADK5VIDG7PB7XCJBGMJDC2PNPCMBC5CW6SJU66T6YEF`.
- Circle testnet USDC asset contract: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
- Default fresh receipt: `a7fda59407b719206fc2afa87afb91069f2370b9629aabcb78e1a5948e9de703`.
- To read another receipt: `/?receipt=<64-character hex ID>`, or use “Receipt & contract details”.

The default receipt was registered, terms accepted, funded with an 8-USDC advance, and approved for 15 test USDC on the deployed contract. It is a one-time fixture: after a successful purchase it remains settled. It must not be reset or advertised as still available. The page always reads the current state from the contract.

[Registration](https://stellar.expert/explorer/testnet/tx/eeb402d6f49fdcea21aa1bd0974017307d241bf48a5ee9fc86f520d6ef2994de) · [Terms acceptance](https://stellar.expert/explorer/testnet/tx/2a9acc8fb391424e42651740970b940af619906b186765579f2bf991709a9e9b) · [Advance](https://stellar.expert/explorer/testnet/tx/37fb9d117f96ac541d5a472b3ee60e87f9119f74fb068cbba13786830b0d094f) · [15-USDC approval](https://stellar.expert/explorer/testnet/tx/4d26b733bcbc5fbc2b090fb7b1b986742bd505ff34fb7f35b1f2359f28479fbb).

The separate demo buyer `GCNRJ2OUZ4UOAV46LYC4I2QO3CLU4BMBUNA4QXA5UOG7MHK3JFPDDGZS` was [funded with 15 test USDC](https://stellar.expert/explorer/testnet/tx/0fefdd5de175c7deb834652e94d8191aa584a9164a444db0da474e045922815f). Any Freighter buyer with sufficient test USDC, a Circle USDC trustline, and test XLM for fees can buy; the receipt is not assigned to a buyer in advance. Never put the CLI demo keys into this repository or the frontend.

## Purchase behavior

1. Read `get_receipt` and `loan_terms` by RPC simulation. The approved price and the 9/1/5 breakdown are live values, not a hardcoded checkout price.
2. Connect with Freighter's `requestAccess`, check the testnet passphrase, and read the buyer's actual USDC balance.
3. Before signing, check the active wallet, receipt stage, exact approved price, and balance again. A price change requires reviewing the refreshed price. A settled receipt cannot be purchased again.
4. Build `buy(id, buyer, payment)` with integer `i128` token units (15 USDC = 150000000). Prepare it with the Stellar SDK, preserving the Soroban authorization entries, then request the buyer's testnet signature in Freighter. Reject a mismatched signer or changed transaction body.
5. Submit and poll `getTransaction`; submission alone is not confirmation. On success refresh `get_receipt` to show the recorded buyer and pickup clearance. Retain the transaction link.

A pending hash is stored locally by contract and receipt before submission, so a connection timeout does not invite another purchase. Reloading preserves the pending transaction; “Refresh status” checks it again. A still-pending result stays pending, and failed/rejected requests never optimistically mark the rug ready. If confirmation succeeds but the subsequent receipt read fails, the hash remains marked confirmed and the buyer can retry the read.

The image is an illustrative SVG pattern, not a photo or verified description of the rug. Pickup means clearance by the contract; the warehouse still handles the physical handoff.
