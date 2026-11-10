extern crate std;
use super::*;
use soroban_sdk::{testutils::Address as _, token, BytesN};

const UNIT: i128 = 10_000_000;

#[test]
fn approved_sale_pays_every_party_and_only_then_unlocks_the_rug() {
    let env = Env::default();
    env.mock_all_auths();
    let warehouse = Address::generate(&env);
    let weaver = Address::generate(&env);
    let lender = Address::generate(&env);
    let buyer = Address::generate(&env);
    let admin = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(admin);
    let token_id = asset.address();
    let token = token::Client::new(&env, &token_id);
    let issuer = token::StellarAssetClient::new(&env, &token_id);
    issuer.mint(&lender, &(8 * UNIT));
    issuer.mint(&buyer, &(15 * UNIT));
    let id = env.register(RugLoan, (&warehouse, &token_id));
    let loan = RugLoanClient::new(&env, &id);
    let receipt = BytesN::from_array(&env, &[1; 32]);
    loan.register_receipt(&receipt, &weaver);
    assert_eq!(loan.get_receipt(&receipt).buyer, None);
    loan.accept_terms(&receipt, &lender);
    loan.fund_loan(&receipt);
    assert_eq!(token.balance(&weaver), 8 * UNIT);
    assert_eq!(token.balance(&lender), 0);
    assert!(!loan.get_receipt(&receipt).ready_for_pickup);
    loan.approve_sale(&receipt, &(15 * UNIT));
    let weaver_before_sale = token.balance(&weaver);
    loan.buy(&receipt, &buyer, &(15 * UNIT));
    assert_eq!(token.balance(&lender), 9 * UNIT);
    assert_eq!(token.balance(&warehouse), UNIT);
    assert_eq!(token.balance(&weaver), 13 * UNIT); // 8 advanced + 5 sale surplus
    assert_eq!(token.balance(&weaver) - weaver_before_sale, 5 * UNIT);
    assert_eq!(token.balance(&buyer), 0);
    assert_eq!(token.balance(&id), 0);
    assert!(loan.get_receipt(&receipt).ready_for_pickup);
    assert_eq!(loan.get_receipt(&receipt).buyer, Some(buyer));
}

struct Fixture {
    env: Env,
    warehouse: Address,
    weaver: Address,
    lender: Address,
    buyer: Address,
    token_id: Address,
    id: Address,
    receipt: BytesN<32>,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let warehouse = Address::generate(&env);
        let weaver = Address::generate(&env);
        let lender = Address::generate(&env);
        let buyer = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(Address::generate(&env));
        asset
            .issuer()
            .set_flag(soroban_sdk::xdr::AccountFlags::RevocableFlag);
        let token_id = asset.address();
        let issuer = token::StellarAssetClient::new(&env, &token_id);
        issuer.mint(&lender, &(16 * UNIT));
        issuer.mint(&buyer, &(30 * UNIT));
        let id = env.register(RugLoan, (&warehouse, &token_id));
        let receipt = BytesN::from_array(&env, &[1; 32]);
        RugLoanClient::new(&env, &id).register_receipt(&receipt, &weaver);
        Self {
            env,
            warehouse,
            weaver,
            lender,
            buyer,
            token_id,
            id,
            receipt,
        }
    }

    fn loan(&self) -> RugLoanClient<'_> {
        RugLoanClient::new(&self.env, &self.id)
    }
    fn funded(&self) {
        self.loan().accept_terms(&self.receipt, &self.lender);
        self.loan().fund_loan(&self.receipt);
        self.loan().approve_sale(&self.receipt, &(15 * UNIT));
    }
    fn balances(&self) -> [i128; 5] {
        let token = token::Client::new(&self.env, &self.token_id);
        [
            &self.lender,
            &self.warehouse,
            &self.weaver,
            &self.buyer,
            &self.id,
        ]
        .map(|address| token.balance(address))
    }
}

#[test]
fn underpayment_cannot_use_other_funds_and_leaves_every_balance_and_receipt_unchanged() {
    let f = Fixture::new();
    f.funded();
    // Even a pre-existing token balance must never subsidize an underpaying buyer.
    token::StellarAssetClient::new(&f.env, &f.token_id).mint(&f.id, &UNIT);
    let before = f.balances();
    let receipt_before = f.loan().get_receipt(&f.receipt);
    assert_eq!(
        f.loan().try_buy(&f.receipt, &f.buyer, &(14 * UNIT)),
        Err(Ok(Error::InvalidPrice))
    );
    assert_eq!(f.balances(), before);
    assert_eq!(f.loan().get_receipt(&f.receipt), receipt_before);
    assert!(!f.loan().get_receipt(&f.receipt).ready_for_pickup);
    assert_eq!(f.loan().get_receipt(&f.receipt).buyer, None);
}

#[test]
fn an_active_receipt_cannot_be_funded_twice_or_pledged_to_another_lender() {
    let f = Fixture::new();
    f.funded();
    let before = f.balances();
    let receipt_before = f.loan().get_receipt(&f.receipt);
    assert_eq!(
        f.loan().try_fund_loan(&f.receipt),
        Err(Ok(Error::WrongStage))
    );
    assert_eq!(
        f.loan().try_accept_terms(&f.receipt, &f.buyer),
        Err(Ok(Error::WrongStage))
    );
    assert_eq!(
        f.loan().try_register_receipt(&f.receipt, &f.buyer),
        Err(Ok(Error::ReceiptExists))
    );
    assert_eq!(f.balances(), before);
    assert_eq!(f.loan().get_receipt(&f.receipt), receipt_before);
}

#[test]
fn a_failed_final_payout_rolls_back_the_buyer_payment_and_both_prior_payouts() {
    let f = Fixture::new();
    f.funded();
    // Freeze the weaver at the real token boundary: lender and warehouse payouts
    // run first, but a failed last transfer must roll the entire invocation back.
    token::StellarAssetClient::new(&f.env, &f.token_id).set_authorized(&f.weaver, &false);
    let before = f.balances();
    let receipt_before = f.loan().get_receipt(&f.receipt);
    assert_eq!(receipt_before.buyer, None);
    assert!(f
        .loan()
        .try_buy(&f.receipt, &f.buyer, &(15 * UNIT))
        .is_err());
    assert_eq!(f.balances(), before);
    assert_eq!(f.loan().get_receipt(&f.receipt), receipt_before);
    assert!(!f.loan().get_receipt(&f.receipt).ready_for_pickup);
    assert_eq!(f.loan().get_receipt(&f.receipt).buyer, None);
    // A failed attempt has not consumed the receipt; settlement can be retried.
    token::StellarAssetClient::new(&f.env, &f.token_id).set_authorized(&f.weaver, &true);
    f.loan().buy(&f.receipt, &f.buyer, &(15 * UNIT));
    assert_eq!(f.balances(), [17 * UNIT, UNIT, 13 * UNIT, 15 * UNIT, 0]);
    assert!(f.loan().get_receipt(&f.receipt).ready_for_pickup);
    assert_eq!(f.loan().get_receipt(&f.receipt).buyer, Some(f.buyer));
}

#[test]
fn a_settled_receipt_cannot_charge_the_buyer_again_or_back_another_loan() {
    let f = Fixture::new();
    f.funded();
    f.loan().buy(&f.receipt, &f.buyer, &(15 * UNIT));
    let before = f.balances();
    assert_eq!(
        f.loan()
            .try_buy(&f.receipt, &Address::generate(&f.env), &(15 * UNIT)),
        Err(Ok(Error::WrongStage))
    );
    assert_eq!(
        f.loan().try_accept_terms(&f.receipt, &f.lender),
        Err(Ok(Error::WrongStage))
    );
    assert_eq!(
        f.loan().try_fund_loan(&f.receipt),
        Err(Ok(Error::WrongStage))
    );
    assert_eq!(f.balances(), before);
    assert!(f.loan().get_receipt(&f.receipt).ready_for_pickup);
    assert_eq!(f.loan().get_receipt(&f.receipt).buyer, Some(f.buyer));
}

#[test]
fn custody_terms_funding_sale_approval_and_purchase_require_the_correct_signers() {
    let f = Fixture::new();
    assert_eq!(f.env.auths()[0].0, f.warehouse);
    f.loan().accept_terms(&f.receipt, &f.lender);
    assert_eq!(f.env.auths()[0].0, f.weaver);
    f.loan().fund_loan(&f.receipt);
    assert_eq!(f.env.auths()[0].0, f.lender);
    f.loan().approve_sale(&f.receipt, &(15 * UNIT));
    assert_eq!(f.env.auths()[0].0, f.weaver);
    f.loan().buy(&f.receipt, &f.buyer, &(15 * UNIT));
    assert_eq!(f.env.auths()[0].0, f.buyer);
}

#[test]
fn missing_signatures_cannot_change_custody_terms_funding_or_sale() {
    let f = Fixture::new();
    f.env.set_auths(&[]);
    let other_receipt = BytesN::from_array(&f.env, &[2; 32]);
    assert!(f
        .loan()
        .try_register_receipt(&other_receipt, &f.weaver)
        .is_err());
    assert_eq!(
        f.loan().try_get_receipt(&other_receipt),
        Err(Ok(Error::ReceiptMissing))
    );
    assert!(f.loan().try_accept_terms(&f.receipt, &f.lender).is_err());
    assert_eq!(f.loan().get_receipt(&f.receipt).stage, Stage::Held);
    f.env.mock_all_auths();
    f.loan().accept_terms(&f.receipt, &f.lender);
    let before = f.balances();
    f.env.set_auths(&[]);
    assert!(f.loan().try_fund_loan(&f.receipt).is_err());
    assert_eq!(f.balances(), before);
    assert_eq!(f.loan().get_receipt(&f.receipt).stage, Stage::TermsAccepted);
    f.env.mock_all_auths();
    f.loan().fund_loan(&f.receipt);
    f.env.set_auths(&[]);
    assert!(f.loan().try_approve_sale(&f.receipt, &(15 * UNIT)).is_err());
    assert_eq!(f.loan().get_receipt(&f.receipt).approved_price, None);
    f.env.mock_all_auths();
    f.loan().approve_sale(&f.receipt, &(15 * UNIT));
    let before = f.balances();
    f.env.set_auths(&[]);
    assert!(f
        .loan()
        .try_buy(&f.receipt, &f.buyer, &(15 * UNIT))
        .is_err());
    assert_eq!(f.balances(), before);
    assert!(!f.loan().get_receipt(&f.receipt).ready_for_pickup);
}

#[test]
fn no_funding_before_terms_and_no_purchase_before_weaver_sale_approval() {
    let f = Fixture::new();
    let before = f.balances();
    assert_eq!(
        f.loan().try_fund_loan(&f.receipt),
        Err(Ok(Error::WrongStage))
    );
    assert_eq!(f.balances(), before);
    f.loan().accept_terms(&f.receipt, &f.lender);
    f.loan().fund_loan(&f.receipt);
    let before = f.balances();
    assert_eq!(
        f.loan().try_buy(&f.receipt, &f.buyer, &(15 * UNIT)),
        Err(Ok(Error::PriceNotApproved))
    );
    assert_eq!(f.balances(), before);
    assert!(!f.loan().get_receipt(&f.receipt).ready_for_pickup);
}

#[test]
fn frontend_can_read_the_exact_fixed_terms_before_weaver_acceptance() {
    let f = Fixture::new();
    let terms = f.loan().loan_terms();
    assert_eq!(terms.advance, 80_000_000);
    assert_eq!(terms.lender_due, 90_000_000);
    assert_eq!(terms.custody_fee, 10_000_000);
}
