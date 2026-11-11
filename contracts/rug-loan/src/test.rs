extern crate std;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, BytesN,
};

struct Fixture {
    env: Env,
    warehouse: Address,
    weaver: Address,
    lender: Address,
    buyer: Address,
    dealer: Address,
    token: Address,
    id: Address,
    receipt: BytesN<32>,
}
impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1000);
        let warehouse = Address::generate(&env);
        let weaver = Address::generate(&env);
        let lender = Address::generate(&env);
        let buyer = Address::generate(&env);
        let dealer = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(Address::generate(&env));
        asset
            .issuer()
            .set_flag(soroban_sdk::xdr::AccountFlags::RevocableFlag);
        let token = asset.address();
        let issuer = token::StellarAssetClient::new(&env, &token);
        issuer.mint(&lender, &(24 * UNIT));
        issuer.mint(&buyer, &(30 * UNIT));
        issuer.mint(&dealer, &(20 * UNIT));
        let id = env.register(RugLoan, (&warehouse, &token));
        let receipt = BytesN::from_array(&env, &[1; 32]);
        let f = Self {
            env,
            warehouse,
            weaver,
            lender,
            buyer,
            dealer,
            token,
            id,
            receipt,
        };
        f.client().register_receipt(&f.receipt, &f.weaver);
        f
    }
    fn client(&self) -> RugLoanClient<'_> {
        RugLoanClient::new(&self.env, &self.id)
    }
    fn terms(&self) -> LoanTerms {
        LoanTerms {
            advance: 8 * UNIT,
            lender_due: 9 * UNIT,
            custody_fee: UNIT,
            fallback_price: 10 * UNIT,
            duration_secs: 60,
            lender: self.lender.clone(),
            dealer: self.dealer.clone(),
        }
    }
    fn accepted(&self) {
        self.client().accept_terms(&self.receipt, &self.terms());
        self.client().accept_fallback(&self.receipt, &self.terms());
    }
    fn funded(&self) {
        self.accepted();
        self.client().fund_loan(&self.receipt);
        self.client().approve_sale(&self.receipt, &(15 * UNIT));
    }
    fn balances(&self) -> [i128; 6] {
        let t = token::Client::new(&self.env, &self.token);
        [
            &self.lender,
            &self.warehouse,
            &self.weaver,
            &self.buyer,
            &self.dealer,
            &self.id,
        ]
        .map(|a| t.balance(a))
    }
    fn time(&self, t: u64) {
        self.env.ledger().with_mut(|l| l.timestamp = t);
    }
}
#[test]
fn normal_sale_keeps_exact_advance_and_three_payouts_with_buyer_pickup() {
    let f = Fixture::new();
    f.funded();
    assert_eq!(
        f.balances(),
        [16 * UNIT, 0, 8 * UNIT, 30 * UNIT, 20 * UNIT, 0]
    );
    let active = f.client().get_receipt(&f.receipt);
    assert_eq!(active.funded_at, Some(1000));
    assert_eq!(active.deadline, Some(1060));
    assert!(!active.ready_for_pickup);
    f.client().buy(&f.receipt, &f.buyer, &(15 * UNIT));
    assert_eq!(
        f.balances(),
        [25 * UNIT, UNIT, 13 * UNIT, 15 * UNIT, 20 * UNIT, 0]
    );
    let r = f.client().get_receipt(&f.receipt);
    assert_eq!(r.stage, Stage::SaleSettled);
    assert_eq!(r.buyer, Some(f.buyer.clone()));
    assert_eq!(r.pickup_recipient, Some(f.buyer));
    assert!(r.ready_for_pickup);
}
#[test]
fn direct_repayment_pays_ten_and_returns_pickup_to_weaver_even_after_deadline() {
    for now in [1059, 1060, 1061] {
        let f = Fixture::new();
        f.funded();
        token::StellarAssetClient::new(&f.env, &f.token).mint(&f.weaver, &(2 * UNIT));
        f.time(now);
        f.client().repay(&f.receipt);
        assert_eq!(f.balances(), [25 * UNIT, UNIT, 0, 30 * UNIT, 20 * UNIT, 0]);
        let r = f.client().get_receipt(&f.receipt);
        assert_eq!(r.stage, Stage::Repaid);
        assert_eq!(r.pickup_recipient, Some(f.weaver));
        assert_eq!(r.buyer, None);
        assert!(r.ready_for_pickup);
    }
}
#[test]
fn committed_dealer_must_pay_after_deadline_before_pickup_is_cleared() {
    let f = Fixture::new();
    f.funded();
    let before = f.balances();
    f.time(1059);
    assert_eq!(
        f.client().try_dealer_buy(&f.receipt),
        Err(Ok(Error::TooEarly))
    );
    assert_eq!(f.balances(), before);
    f.time(1060);
    let overdue = f.client().get_receipt(&f.receipt);
    assert_eq!(overdue.stage, Stage::Overdue);
    assert!(!overdue.ready_for_pickup);
    assert_eq!(overdue.pickup_recipient, None);
    f.client().dealer_buy(&f.receipt);
    assert_eq!(
        f.balances(),
        [25 * UNIT, UNIT, 8 * UNIT, 30 * UNIT, 10 * UNIT, 0]
    );
    let r = f.client().get_receipt(&f.receipt);
    assert_eq!(r.stage, Stage::DealerPurchased);
    assert_eq!(r.buyer, Some(f.dealer.clone()));
    assert_eq!(r.pickup_recipient, Some(f.dealer));
    assert!(r.ready_for_pickup);
}
#[test]
fn lender_cannot_fund_before_weaver_and_exact_dealer_acceptance() {
    let f = Fixture::new();
    let before = f.balances();
    assert_eq!(
        f.client().try_fund_loan(&f.receipt),
        Err(Ok(Error::WrongStage))
    );
    f.client().accept_terms(&f.receipt, &f.terms());
    assert_eq!(
        f.client().try_fund_loan(&f.receipt),
        Err(Ok(Error::DealerNotCommitted))
    );
    let mut wrong = f.terms();
    wrong.fallback_price = 11 * UNIT;
    assert_eq!(
        f.client().try_accept_fallback(&f.receipt, &wrong),
        Err(Ok(Error::TermsMismatch))
    );
    assert_eq!(f.balances(), before);
    assert!(!f.client().get_receipt(&f.receipt).dealer_committed);
    f.client().accept_fallback(&f.receipt, &f.terms());
    assert_eq!(f.balances(), before);
    assert!(!f.client().get_receipt(&f.receipt).ready_for_pickup);
}
#[test]
fn accepted_terms_and_dealer_cannot_be_replaced() {
    let f = Fixture::new();
    f.accepted();
    let before = f.client().get_receipt(&f.receipt);
    let mut changed = f.terms();
    changed.dealer = f.buyer.clone();
    assert_eq!(
        f.client().try_accept_terms(&f.receipt, &changed),
        Err(Ok(Error::WrongStage))
    );
    assert_eq!(
        f.client().try_accept_fallback(&f.receipt, &changed),
        Err(Ok(Error::WrongStage))
    );
    assert_eq!(f.client().get_receipt(&f.receipt), before);
}
#[test]
fn invalid_amounts_overflow_and_durations_are_rejected_without_locking_terms() {
    for case in 0..8 {
        let f = Fixture::new();
        let mut t = f.terms();
        let expected = match case {
            0 => {
                t.advance = 0;
                Error::InvalidAmount
            }
            1 => {
                t.advance = -1;
                Error::InvalidAmount
            }
            2 => {
                t.lender_due = 7 * UNIT;
                Error::InvalidAmount
            }
            3 => {
                t.custody_fee = -1;
                Error::InvalidAmount
            }
            4 => {
                t.fallback_price = 9 * UNIT;
                Error::InvalidAmount
            }
            5 => {
                t.duration_secs = 29;
                Error::InvalidDuration
            }
            6 => {
                t.duration_secs = 86401;
                Error::InvalidDuration
            }
            _ => {
                t.lender_due = i128::MAX;
                t.custody_fee = 1;
                Error::InvalidAmount
            }
        };
        let before = f.balances();
        assert_eq!(
            f.client().try_accept_terms(&f.receipt, &t),
            Err(Ok(expected))
        );
        assert_eq!(f.balances(), before);
        assert_eq!(f.client().get_receipt(&f.receipt).stage, Stage::Held);
    }
}
#[test]
fn only_exact_approved_price_is_paid_even_with_stray_contract_funds() {
    let f = Fixture::new();
    f.funded();
    token::StellarAssetClient::new(&f.env, &f.token).mint(&f.id, &UNIT);
    let before = f.balances();
    let receipt = f.client().get_receipt(&f.receipt);
    for payment in [-1, 0, 14 * UNIT, 16 * UNIT] {
        assert_eq!(
            f.client().try_buy(&f.receipt, &f.buyer, &payment),
            Err(Ok(Error::InvalidAmount))
        );
        assert_eq!(f.balances(), before);
        assert_eq!(f.client().get_receipt(&f.receipt), receipt);
    }
    assert_eq!(
        f.client().try_approve_sale(&f.receipt, &(9 * UNIT)),
        Err(Ok(Error::InvalidAmount))
    );
}
#[test]
fn deadline_boundary_closes_sale_and_keeps_unpaid_overdue_rug_locked() {
    let f = Fixture::new();
    f.funded();
    let before = f.balances();
    f.time(1059);
    assert_eq!(f.client().get_receipt(&f.receipt).stage, Stage::Active);
    f.time(1060);
    assert_eq!(
        f.client().try_buy(&f.receipt, &f.buyer, &(15 * UNIT)),
        Err(Ok(Error::DeadlinePassed))
    );
    assert_eq!(
        f.client().try_approve_sale(&f.receipt, &(15 * UNIT)),
        Err(Ok(Error::DeadlinePassed))
    );
    let r = f.client().get_receipt(&f.receipt);
    assert_eq!(r.stage, Stage::Overdue);
    assert!(!r.ready_for_pickup);
    assert_eq!(r.buyer, None);
    assert_eq!(r.pickup_recipient, None);
    assert_eq!(f.balances(), before);
}
#[test]
fn failed_advance_does_not_start_deadline_or_activate_loan() {
    let f = Fixture::new();
    f.accepted();
    token::Client::new(&f.env, &f.token).burn(&f.lender, &(24 * UNIT));
    let before = f.balances();
    assert!(f.client().try_fund_loan(&f.receipt).is_err());
    assert_eq!(f.balances(), before);
    let r = f.client().get_receipt(&f.receipt);
    assert_eq!(r.stage, Stage::TermsAccepted);
    assert_eq!(r.funded_at, None);
    assert_eq!(r.deadline, None);
}
#[test]
fn one_receipt_cannot_be_registered_or_funded_twice() {
    let f = Fixture::new();
    f.funded();
    let before = f.balances();
    assert_eq!(
        f.client().try_register_receipt(&f.receipt, &f.buyer),
        Err(Ok(Error::ReceiptExists))
    );
    assert_eq!(
        f.client().try_fund_loan(&f.receipt),
        Err(Ok(Error::WrongStage))
    );
    assert_eq!(f.balances(), before);
}
#[test]
fn no_final_state_can_be_settled_again_or_have_pickup_recipient_replaced() {
    for outcome in 0..3 {
        let f = Fixture::new();
        f.funded();
        match outcome {
            0 => f.client().buy(&f.receipt, &f.buyer, &(15 * UNIT)),
            1 => {
                token::StellarAssetClient::new(&f.env, &f.token).mint(&f.weaver, &(2 * UNIT));
                f.client().repay(&f.receipt)
            }
            _ => {
                f.time(1060);
                f.client().dealer_buy(&f.receipt)
            }
        };
        let before = f.balances();
        let r = f.client().get_receipt(&f.receipt);
        assert_eq!(
            f.client().try_buy(&f.receipt, &f.dealer, &(15 * UNIT)),
            Err(Ok(Error::WrongStage))
        );
        assert_eq!(f.client().try_repay(&f.receipt), Err(Ok(Error::WrongStage)));
        assert_eq!(
            f.client().try_dealer_buy(&f.receipt),
            Err(Ok(Error::WrongStage))
        );
        assert_eq!(
            f.client().try_fund_loan(&f.receipt),
            Err(Ok(Error::WrongStage))
        );
        assert_eq!(f.balances(), before);
        assert_eq!(f.client().get_receipt(&f.receipt), r);
    }
}
#[test]
fn failed_last_payout_rolls_back_every_outcome_and_preserves_locked_receipt() {
    for outcome in 0..3 {
        let f = Fixture::new();
        f.funded();
        let frozen = if outcome == 0 {
            f.weaver.clone()
        } else {
            f.warehouse.clone()
        };
        if outcome == 1 {
            token::StellarAssetClient::new(&f.env, &f.token).mint(&f.weaver, &(2 * UNIT));
        }
        if outcome == 2 {
            f.time(1060);
        }
        token::StellarAssetClient::new(&f.env, &f.token).set_authorized(&frozen, &false);
        let before = f.balances();
        let r = f.client().get_receipt(&f.receipt);
        match outcome {
            0 => assert!(f
                .client()
                .try_buy(&f.receipt, &f.buyer, &(15 * UNIT))
                .is_err()),
            1 => assert!(f.client().try_repay(&f.receipt).is_err()),
            _ => assert!(f.client().try_dealer_buy(&f.receipt).is_err()),
        };
        assert_eq!(f.balances(), before);
        assert_eq!(f.client().get_receipt(&f.receipt), r);
        assert!(!r.ready_for_pickup);
        token::StellarAssetClient::new(&f.env, &f.token).set_authorized(&frozen, &true);
        match outcome {
            0 => f.client().buy(&f.receipt, &f.buyer, &(15 * UNIT)),
            1 => f.client().repay(&f.receipt),
            _ => f.client().dealer_buy(&f.receipt),
        };
        assert!(f.client().get_receipt(&f.receipt).ready_for_pickup);
    }
}
#[test]
fn dealer_promise_cannot_settle_an_unpaid_rug() {
    let f = Fixture::new();
    f.funded();
    f.time(1060);
    token::Client::new(&f.env, &f.token).burn(&f.dealer, &(20 * UNIT));
    let before = f.balances();
    assert!(f.client().try_dealer_buy(&f.receipt).is_err());
    assert_eq!(f.balances(), before);
    let r = f.client().get_receipt(&f.receipt);
    assert_eq!(r.stage, Stage::Overdue);
    assert!(!r.ready_for_pickup);
    assert_eq!(r.pickup_recipient, None);
}
#[test]
fn all_roles_require_the_nominated_signer_and_missing_signatures_move_nothing() {
    let f = Fixture::new();
    assert_eq!(f.env.auths()[0].0, f.warehouse);
    f.env.set_auths(&[]);
    let other = BytesN::from_array(&f.env, &[2; 32]);
    assert!(f.client().try_register_receipt(&other, &f.weaver).is_err());
    assert!(f.client().try_accept_terms(&f.receipt, &f.terms()).is_err());
    f.env.mock_all_auths();
    f.client().accept_terms(&f.receipt, &f.terms());
    assert_eq!(f.env.auths()[0].0, f.weaver);
    f.env.set_auths(&[]);
    assert!(f
        .client()
        .try_accept_fallback(&f.receipt, &f.terms())
        .is_err());
    f.env.mock_all_auths();
    f.client().accept_fallback(&f.receipt, &f.terms());
    assert_eq!(f.env.auths()[0].0, f.dealer);
    f.env.set_auths(&[]);
    assert!(f.client().try_fund_loan(&f.receipt).is_err());
    f.env.mock_all_auths();
    f.client().fund_loan(&f.receipt);
    assert_eq!(f.env.auths()[0].0, f.lender);
    f.env.set_auths(&[]);
    assert!(f
        .client()
        .try_approve_sale(&f.receipt, &(15 * UNIT))
        .is_err());
    f.env.mock_all_auths();
    f.client().approve_sale(&f.receipt, &(15 * UNIT));
    assert_eq!(f.env.auths()[0].0, f.weaver);
    let before = f.balances();
    f.env.set_auths(&[]);
    assert!(f
        .client()
        .try_buy(&f.receipt, &f.buyer, &(15 * UNIT))
        .is_err());
    assert!(f.client().try_repay(&f.receipt).is_err());
    f.time(1060);
    assert!(f.client().try_dealer_buy(&f.receipt).is_err());
    assert_eq!(f.balances(), before);
}
#[test]
fn sale_requires_separate_weaver_price_approval() {
    let f = Fixture::new();
    f.accepted();
    f.client().fund_loan(&f.receipt);
    let before = f.balances();
    assert_eq!(
        f.client().try_buy(&f.receipt, &f.buyer, &(15 * UNIT)),
        Err(Ok(Error::PriceNotApproved))
    );
    assert_eq!(f.balances(), before);
}
#[test]
fn two_distinct_receipts_can_be_funded_independently() {
    let f = Fixture::new();
    f.funded();
    let other = BytesN::from_array(&f.env, &[2; 32]);
    f.client().register_receipt(&other, &f.weaver);
    f.client().accept_terms(&other, &f.terms());
    f.client().accept_fallback(&other, &f.terms());
    f.client().fund_loan(&other);
    assert_eq!(
        f.balances(),
        [8 * UNIT, 0, 16 * UNIT, 30 * UNIT, 20 * UNIT, 0]
    );
    assert_eq!(f.client().get_receipt(&other).stage, Stage::Active);
}

#[test]
fn terms_are_recorded_per_rug_instead_of_using_global_payout_constants() {
    let f = Fixture::new();
    let mut t = f.terms();
    t.advance = 4 * UNIT;
    t.lender_due = 5 * UNIT;
    t.custody_fee = 2 * UNIT;
    t.fallback_price = 9 * UNIT;
    t.duration_secs = 120;
    f.client().accept_terms(&f.receipt, &t);
    f.client().accept_fallback(&f.receipt, &t);
    f.client().fund_loan(&f.receipt);
    assert_eq!(f.client().get_receipt(&f.receipt).deadline, Some(1120));
    f.client().approve_sale(&f.receipt, &(15 * UNIT));
    f.client().buy(&f.receipt, &f.buyer, &(15 * UNIT));
    assert_eq!(
        f.balances(),
        [25 * UNIT, 2 * UNIT, 12 * UNIT, 15 * UNIT, 20 * UNIT, 0]
    );
}

#[test]
fn fallback_surplus_goes_to_weaver_and_zero_surplus_requires_no_weaver_transfer() {
    for fallback in [10, 12] {
        let f = Fixture::new();
        let mut t = f.terms();
        t.fallback_price = fallback * UNIT;
        f.client().accept_terms(&f.receipt, &t);
        f.client().accept_fallback(&f.receipt, &t);
        f.client().fund_loan(&f.receipt);
        f.time(1060);
        if fallback == 10 {
            token::StellarAssetClient::new(&f.env, &f.token).set_authorized(&f.weaver, &false);
        }
        f.client().dealer_buy(&f.receipt);
        assert_eq!(f.env.auths()[0].0, f.dealer);
        if fallback == 10 {
            assert_eq!(
                f.balances(),
                [25 * UNIT, UNIT, 8 * UNIT, 30 * UNIT, 10 * UNIT, 0]
            );
        } else {
            assert_eq!(
                f.balances(),
                [25 * UNIT, UNIT, 10 * UNIT, 30 * UNIT, 8 * UNIT, 0]
            );
        }
    }
}
