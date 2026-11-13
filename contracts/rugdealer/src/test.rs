#![cfg(test)]

use crate::{
    Error, FrozenReason, LoanCancelled, LoanRequested, LoanStatus, RugClaimed, RugDealer,
    RugDealerClient, RugMinted, RugRedeemed, RugStatus, StoreFrozen,
};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger, MockAuth, MockAuthInvoke};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{Address, Env, Event as _, IntoVal, String};

const USDC: i128 = 10_000_000;

struct TestEnv {
    env: Env,
    contract: Address,
    admin: Address,
    fee_recipient: Address,
    store: Address,
    weaver: Address,
    investor: Address,
    usdc: Address,
    rug_id: u64,
}

impl TestEnv {
    fn new() -> Self {
        Self::with_config(1_000 * USDC, 1500, 100, 25, 12, 60, 60)
    }

    fn with_config(
        limit: i128,
        interest_bps_per_year: u32,
        platform_fee_bps: u32,
        store_fee_bps_per_month: u32,
        max_months: u32,
        month_seconds: u64,
        buyout_window_seconds: u64,
    ) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let fee_recipient = Address::generate(&env);
        let store = Address::generate(&env);
        let weaver = Address::generate(&env);
        let investor = Address::generate(&env);
        let usdc_issuer = Address::generate(&env);

        let usdc_sac = env.register_stellar_asset_contract_v2(usdc_issuer);
        usdc_sac
            .issuer()
            .set_flag(soroban_sdk::testutils::IssuerFlags::RevocableFlag);
        let usdc = usdc_sac.address();
        let contract = env.register(
            RugDealer,
            (
                admin.clone(),
                usdc.clone(),
                fee_recipient.clone(),
                interest_bps_per_year,
                platform_fee_bps,
                store_fee_bps_per_month,
                max_months,
                month_seconds,
                buyout_window_seconds,
            ),
        );

        StellarAssetClient::new(&env, &usdc).mint(&investor, &(10_000 * USDC));
        StellarAssetClient::new(&env, &usdc).mint(&weaver, &(10_000 * USDC));

        let mut test = Self {
            env,
            contract,
            admin,
            fee_recipient,
            store,
            weaver,
            investor,
            usdc,
            rug_id: 0,
        };

        test.client().register_store(&test.store, &limit);
        test.rug_id = test.mint_rug(600 * USDC);
        test
    }

    fn client(&self) -> RugDealerClient<'_> {
        RugDealerClient::new(&self.env, &self.contract)
    }

    fn balance(&self, address: &Address) -> i128 {
        TokenClient::new(&self.env, &self.usdc).balance(address)
    }

    fn mint_rug(&self, price: i128) -> u64 {
        self.client().mint_rug(
            &self.store,
            &self.weaver,
            &String::from_str(&self.env, "Hand-knotted rug"),
            &price,
        )
    }

    fn request(&self, rug_id: u64, months: u32) -> u64 {
        self.client().request_loan(&self.weaver, &rug_id, &months)
    }

    fn fund(&self, loan_id: u64) {
        self.client().fund_loan(&self.investor, &loan_id);
    }

    fn request_and_fund(&self, rug_id: u64, months: u32) -> u64 {
        let loan_id = self.request(rug_id, months);
        self.fund(loan_id);
        loan_id
    }

    fn set_time(&self, timestamp: u64) {
        self.env.ledger().set_timestamp(timestamp);
    }

    fn mint_usdc(&self, to: &Address, amount: i128) {
        StellarAssetClient::new(&self.env, &self.usdc).mint(to, &amount);
    }

    fn set_authorized(&self, address: &Address, authorized: bool) {
        StellarAssetClient::new(&self.env, &self.usdc).set_authorized(address, &authorized);
    }
}

fn contract_error<T, E>(
    result: Result<Result<T, E>, Result<Error, soroban_sdk::InvokeError>>,
) -> Error
where
    T: core::fmt::Debug,
    E: core::fmt::Debug,
{
    match result {
        Err(Ok(error)) => error,
        other => panic!("expected a contract error, got {:?}", other),
    }
}

#[test]
fn worked_example_money_flows() {
    let test = TestEnv::new();
    let client = test.client();

    let quote = client.quote(&(600 * USDC), &6);
    assert_eq!(quote.interest, 45 * USDC);
    assert_eq!(quote.platform_fee, 6 * USDC);
    assert_eq!(quote.store_fee, 9 * USDC);
    assert_eq!(quote.weaver_payout, 540 * USDC);
    assert_eq!(quote.investor_payout, 645 * USDC);
    assert_eq!(
        quote.interest + quote.platform_fee + quote.store_fee + quote.weaver_payout,
        600 * USDC
    );

    let loan_id = test.request_and_fund(test.rug_id, 6);

    assert_eq!(test.balance(&test.investor), 9_400 * USDC);
    assert_eq!(test.balance(&test.weaver), 10_540 * USDC);
    assert_eq!(test.balance(&test.store), 9 * USDC);
    assert_eq!(test.balance(&test.fee_recipient), 6 * USDC);
    assert_eq!(test.balance(&test.contract), 45 * USDC);

    client.repay(&loan_id);

    assert_eq!(test.balance(&test.investor), 10_045 * USDC);
    assert_eq!(test.balance(&test.weaver), 9_940 * USDC);
    assert_eq!(test.balance(&test.store), 9 * USDC);
    assert_eq!(test.balance(&test.fee_recipient), 6 * USDC);
    assert_eq!(test.balance(&test.contract), 0);

    let rug = client.get_rug(&test.rug_id);
    assert_eq!(rug.owner, test.weaver);
    assert_eq!(rug.status, RugStatus::Free);

    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Repaid);
    assert_eq!(loan.investor, Some(test.investor.clone()));

    let store = client.get_store(&test.store);
    assert_eq!(store.open_principal, 0);
    assert_eq!(client.get_credit(&test.investor), 0);
}

#[test]
fn rounding_is_floor_and_payouts_sum_to_principal() {
    let test = TestEnv::new();
    let client = test.client();

    let principal = 1_000_000_001;
    let quote = client.quote(&principal, &1);
    assert_eq!(quote.interest, 12_500_000);
    assert_eq!(quote.platform_fee, 10_000_000);
    assert_eq!(quote.store_fee, 2_500_000);
    assert_eq!(quote.weaver_payout, 975_000_001);
    assert_eq!(quote.investor_payout, 1_012_500_001);
    assert_eq!(
        quote.interest + quote.platform_fee + quote.store_fee + quote.weaver_payout,
        principal
    );
}

#[test]
fn money_rules_come_from_constructor_parameters() {
    let test = TestEnv::with_config(1_000 * USDC, 1200, 50, 10, 6, 60, 60);
    let quote = test.client().quote(&(600 * USDC), &6);

    assert_eq!(quote.interest, 36 * USDC);
    assert_eq!(quote.platform_fee, 3 * USDC);
    assert_eq!(quote.store_fee, 36_000_000);
    assert_eq!(quote.weaver_payout, 5_574_000_000);
    assert_eq!(quote.investor_payout, 636 * USDC);
}

#[test]
#[should_panic]
fn constructor_rejects_zero_month() {
    constructor(1500, 100, 25, 12, 0, 60);
}

#[test]
#[should_panic]
fn constructor_rejects_zero_window() {
    constructor(1500, 100, 25, 12, 60, 0);
}

#[test]
#[should_panic]
fn constructor_rejects_more_than_twelve_months() {
    constructor(1500, 100, 25, 13, 60, 60);
}

#[test]
#[should_panic]
fn constructor_rejects_ninety_nine_percent_fees() {
    constructor(10_000, 100, 25, 12, 60, 60);
}

fn constructor(
    interest_bps_per_year: u32,
    platform_fee_bps: u32,
    store_fee_bps_per_month: u32,
    max_months: u32,
    month_seconds: u64,
    buyout_window_seconds: u64,
) {
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(issuer).address();
    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let _ = env.register(
        RugDealer,
        (
            admin,
            usdc,
            fee_recipient,
            interest_bps_per_year,
            platform_fee_bps,
            store_fee_bps_per_month,
            max_months,
            month_seconds,
            buyout_window_seconds,
        ),
    );
}

#[test]
fn store_limit_is_measured_in_principal() {
    let test = TestEnv::with_config(1_000 * USDC, 1500, 100, 25, 12, 60, 60);
    let second_rug = test.mint_rug(500 * USDC);
    let first_loan = test.request(test.rug_id, 6);
    assert_eq!(
        test.client().get_store(&test.store).open_principal,
        600 * USDC
    );

    let error = contract_error(
        test.client()
            .try_request_loan(&test.weaver, &second_rug, &6),
    );
    assert_eq!(error, Error::StoreLimitExceeded);

    test.client().cancel_request(&first_loan);
    assert_eq!(test.client().get_store(&test.store).open_principal, 0);
    let second_loan = test.request(second_rug, 6);
    assert_eq!(
        test.client().get_store(&test.store).open_principal,
        500 * USDC
    );
    assert_eq!(
        test.client().get_loan(&second_loan).status,
        LoanStatus::Requested
    );
}

#[test]
fn cancel_releases_principal_and_rejects_funding() {
    let test = TestEnv::new();
    let loan_id = test.request(test.rug_id, 6);
    test.client().cancel_request(&loan_id);

    let loan = test.client().get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Cancelled);
    assert_eq!(test.client().get_rug(&test.rug_id).status, RugStatus::Free);
    assert_eq!(test.client().get_store(&test.store).open_principal, 0);

    assert_eq!(
        contract_error(test.client().try_cancel_request(&loan_id)),
        Error::LoanNotRequested
    );
    assert_eq!(
        contract_error(test.client().try_fund_loan(&test.investor, &loan_id)),
        Error::LoanNotRequested
    );
}

#[test]
fn repay_releases_principal_and_allows_reborrow() {
    let test = TestEnv::new();
    let first = test.request_and_fund(test.rug_id, 6);
    test.client().repay(&first);
    assert_eq!(test.client().get_store(&test.store).open_principal, 0);

    let second = test.request(test.rug_id, 6);
    test.client().cancel_request(&second);
}

#[test]
fn one_open_loan_per_rug() {
    let test = TestEnv::new();
    let _loan = test.request(test.rug_id, 6);
    assert_eq!(
        contract_error(
            test.client()
                .try_request_loan(&test.weaver, &test.rug_id, &6)
        ),
        Error::RugNotFree
    );
}

#[test]
fn only_the_owner_can_request_against_a_rug() {
    let test = TestEnv::new();
    assert_eq!(
        contract_error(
            test.client()
                .try_request_loan(&test.investor, &test.rug_id, &6)
        ),
        Error::NotRugOwner
    );
}

#[test]
fn loan_length_is_whole_months_within_maximum() {
    let test = TestEnv::new();
    assert_eq!(
        contract_error(test.client().try_quote(&(600 * USDC), &0)),
        Error::InvalidMonths
    );
    assert_eq!(
        contract_error(test.client().try_quote(&(600 * USDC), &13)),
        Error::InvalidMonths
    );
    let one_month = test.request(test.rug_id, 1);
    test.client().cancel_request(&one_month);

    let custom = TestEnv::with_config(1_000 * USDC, 1500, 100, 25, 6, 60, 60);
    assert_eq!(
        contract_error(
            custom
                .client()
                .try_request_loan(&custom.weaver, &custom.rug_id, &7)
        ),
        Error::InvalidMonths
    );
}

#[test]
fn mint_validates_price_description_and_duplicate_store() {
    let test = TestEnv::new();
    let client = test.client();

    assert_eq!(
        contract_error(client.try_mint_rug(
            &test.store,
            &test.weaver,
            &String::from_str(&test.env, ""),
            &(100 * USDC),
        )),
        Error::InvalidDescription
    );

    let long = "x".repeat(281);
    assert_eq!(
        contract_error(client.try_mint_rug(
            &test.store,
            &test.weaver,
            &String::from_str(&test.env, &long),
            &(100 * USDC),
        )),
        Error::InvalidDescription
    );

    assert_eq!(
        contract_error(client.try_mint_rug(
            &test.store,
            &test.weaver,
            &String::from_str(&test.env, "Free rug"),
            &0,
        )),
        Error::InvalidPrice
    );

    assert_eq!(
        contract_error(client.try_register_store(&test.store, &(100 * USDC))),
        Error::StoreAlreadyRegistered
    );
    assert_eq!(
        contract_error(client.try_set_store_limit(&test.store, &-1)),
        Error::InvalidLimit
    );
    assert_eq!(
        contract_error(client.try_set_store_limit(&test.investor, &(100 * USDC))),
        Error::StoreNotRegistered
    );
    assert_eq!(
        contract_error(client.try_freeze_store(&test.investor)),
        Error::StoreNotRegistered
    );
}

#[test]
fn freeze_blocks_mint_but_not_request_or_fund() {
    let test = TestEnv::new();
    let second_rug = test.mint_rug(400 * USDC);
    test.client().freeze_store(&test.store);
    assert!(test.client().get_store(&test.store).frozen);

    assert_eq!(
        contract_error(test.client().try_mint_rug(
            &test.store,
            &test.weaver,
            &String::from_str(&test.env, "Blocked rug"),
            &(100 * USDC),
        )),
        Error::StoreFrozen
    );

    let loan_id = test.request_and_fund(second_rug, 6);
    assert_eq!(test.client().get_loan(&loan_id).status, LoanStatus::Funded);
}

#[test]
fn fund_split_is_exact_and_double_fund_is_rejected() {
    let test = TestEnv::new();
    let loan_id = test.request(test.rug_id, 6);
    test.fund(loan_id);

    assert_eq!(test.balance(&test.investor), 9_400 * USDC);
    assert_eq!(test.balance(&test.weaver), 10_540 * USDC);
    assert_eq!(test.balance(&test.store), 9 * USDC);
    assert_eq!(test.balance(&test.fee_recipient), 6 * USDC);
    assert_eq!(test.balance(&test.contract), 45 * USDC);

    assert_eq!(
        contract_error(test.client().try_fund_loan(&test.investor, &loan_id)),
        Error::LoanNotRequested
    );
}

#[test]
fn fund_rechecks_a_lowered_store_limit() {
    let test = TestEnv::new();
    let loan_id = test.request(test.rug_id, 6);
    test.client().set_store_limit(&test.store, &(100 * USDC));

    assert_eq!(
        contract_error(test.client().try_fund_loan(&test.investor, &loan_id)),
        Error::StoreLimitExceeded
    );
}

#[test]
fn repay_is_allowed_after_the_end_date() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    assert!(!test.client().is_overdue(&loan_id));

    test.set_time(end_at - 1);
    assert!(!test.client().is_overdue(&loan_id));
    test.set_time(end_at);
    assert!(test.client().is_overdue(&loan_id));

    test.client().repay(&loan_id);
    assert_eq!(test.client().get_loan(&loan_id).status, LoanStatus::Repaid);
}

#[test]
fn repay_and_fund_reject_second_calls() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    test.client().repay(&loan_id);
    assert_eq!(
        contract_error(test.client().try_repay(&loan_id)),
        Error::LoanSettled
    );
}

#[test]
fn redeem_is_terminal_and_requires_a_free_rug() {
    let test = TestEnv::new();
    let client = test.client();

    let loan_id = test.request(test.rug_id, 6);
    assert_eq!(
        contract_error(client.try_redeem(&test.weaver, &test.rug_id)),
        Error::RugNotFree
    );
    client.cancel_request(&loan_id);

    assert_eq!(
        contract_error(client.try_redeem(&test.investor, &test.rug_id)),
        Error::NotRugOwner
    );

    client.redeem(&test.weaver, &test.rug_id);
    assert_eq!(client.get_rug(&test.rug_id).status, RugStatus::Redeemed);
    assert_eq!(
        contract_error(client.try_redeem(&test.weaver, &test.rug_id)),
        Error::RugNotFree
    );
}

#[test]
fn redeem_works_when_store_is_frozen() {
    let test = TestEnv::new();
    test.client().freeze_store(&test.store);
    test.client().redeem(&test.weaver, &test.rug_id);
    assert_eq!(
        test.client().get_rug(&test.rug_id).status,
        RugStatus::Redeemed
    );
}

#[test]
fn redeem_requires_both_holder_and_store_auth() {
    let test = TestEnv::new();
    test.env.set_auths(&[]);
    let client = test.client();

    let holder_invoke = MockAuthInvoke {
        contract: &test.contract,
        fn_name: "redeem",
        args: (&test.weaver, test.rug_id).into_val(&test.env),
        sub_invokes: &[],
    };
    let store_invoke = MockAuthInvoke {
        contract: &test.contract,
        fn_name: "redeem",
        args: (&test.weaver, test.rug_id).into_val(&test.env),
        sub_invokes: &[],
    };

    test.env.mock_auths(&[MockAuth {
        address: &test.weaver,
        invoke: &holder_invoke,
    }]);
    assert!(client.try_redeem(&test.weaver, &test.rug_id).is_err());

    test.env.mock_auths(&[MockAuth {
        address: &test.store,
        invoke: &store_invoke,
    }]);
    assert!(client.try_redeem(&test.weaver, &test.rug_id).is_err());

    test.env.mock_auths(&[
        MockAuth {
            address: &test.weaver,
            invoke: &holder_invoke,
        },
        MockAuth {
            address: &test.store,
            invoke: &store_invoke,
        },
    ]);
    client.redeem(&test.weaver, &test.rug_id);
    assert_eq!(
        test.client().get_rug(&test.rug_id).status,
        RugStatus::Redeemed
    );
}

#[test]
fn signer_functions_fail_without_auth() {
    let test = TestEnv::new();
    let loan_id = test.request(test.rug_id, 6);
    let second_rug = test.mint_rug(100 * USDC);
    test.env.set_auths(&[]);
    let client = test.client();

    assert!(client
        .try_register_store(&test.investor, &(100 * USDC))
        .is_err());
    assert!(client
        .try_set_store_limit(&test.store, &(100 * USDC))
        .is_err());
    assert!(client.try_freeze_store(&test.store).is_err());
    assert!(client
        .try_mint_rug(
            &test.store,
            &test.weaver,
            &String::from_str(&test.env, "No auth"),
            &(100 * USDC),
        )
        .is_err());
    assert!(client
        .try_request_loan(&test.weaver, &second_rug, &6)
        .is_err());
    assert!(client.try_cancel_request(&loan_id).is_err());
    assert!(client.try_fund_loan(&test.investor, &loan_id).is_err());
    assert!(client.try_redeem(&test.weaver, &test.rug_id).is_err());

    test.env.mock_all_auths();
    test.fund(loan_id);
    test.env.set_auths(&[]);
    assert!(client.try_repay(&loan_id).is_err());
}

#[test]
fn config_is_stored_with_all_deployment_parameters() {
    let test = TestEnv::with_config(2_500 * USDC, 1200, 50, 10, 6, 90, 30);
    let config = test.client().get_config();

    assert_eq!(config.admin, test.admin);
    assert_eq!(config.usdc, test.usdc);
    assert_eq!(config.fee_recipient, test.fee_recipient);
    assert_eq!(config.interest_bps_per_year, 1200);
    assert_eq!(config.platform_fee_bps, 50);
    assert_eq!(config.store_fee_bps_per_month, 10);
    assert_eq!(config.max_months, 6);
    assert_eq!(config.month_seconds, 90);
    assert_eq!(config.buyout_window_seconds, 30);
}

#[test]
fn set_store_limit_updates_the_principal_cap() {
    let test = TestEnv::new();
    let client = test.client();

    client.set_store_limit(&test.store, &(500 * USDC));
    assert_eq!(client.get_store(&test.store).limit, 500 * USDC);
    assert_eq!(
        contract_error(client.try_request_loan(&test.weaver, &test.rug_id, &6)),
        Error::StoreLimitExceeded
    );

    client.set_store_limit(&test.store, &(600 * USDC));
    let loan_id = test.request(test.rug_id, 6);
    client.cancel_request(&loan_id);
}

#[test]
fn mint_accepts_280_byte_description_and_assigns_sequential_ids() {
    let test = TestEnv::new();
    let client = test.client();
    let description = "x".repeat(280);

    let rug_id = client.mint_rug(
        &test.store,
        &test.weaver,
        &String::from_str(&test.env, &description),
        &(100 * USDC),
    );
    assert_eq!(rug_id, 2);
    assert_eq!(client.next_rug_id(), 3);
    assert_eq!(
        client.get_rug(&rug_id).description,
        String::from_str(&test.env, &description)
    );

    let loan_id = test.request(rug_id, 6);
    assert_eq!(loan_id, 1);
    assert_eq!(client.next_loan_id(), 2);
    assert_eq!(client.get_loan(&loan_id).id, 1);
    client.cancel_request(&loan_id);
}

#[test]
fn overdue_clears_after_repayment() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    test.set_time(end_at);
    assert!(test.client().is_overdue(&loan_id));

    test.client().repay(&loan_id);
    assert!(!test.client().is_overdue(&loan_id));
}

#[test]
fn store_buyout_rejects_at_end_minus_one() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    test.set_time(end_at - 1);
    assert_eq!(
        contract_error(test.client().try_store_buyout(&loan_id)),
        Error::TooEarly
    );
}

#[test]
fn store_buyout_allowed_at_end() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    test.mint_usdc(&test.store, 1_000 * USDC);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    test.set_time(end_at);

    test.client().store_buyout(&loan_id);

    assert_eq!(test.balance(&test.investor), 10_045 * USDC);
    assert_eq!(test.balance(&test.store), 409 * USDC);
    assert_eq!(test.balance(&test.contract), 0);
    assert_eq!(
        test.client().get_loan(&loan_id).status,
        LoanStatus::BoughtOut
    );
    let rug = test.client().get_rug(&test.rug_id);
    assert_eq!(rug.owner, test.store);
    assert_eq!(rug.status, RugStatus::Free);
    assert_eq!(test.client().get_store(&test.store).open_principal, 0);
    assert!(!test.client().is_overdue(&loan_id));
    assert_eq!(test.client().get_credit(&test.investor), 0);
}

#[test]
fn store_buyout_allowed_at_window_end_minus_one() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    test.mint_usdc(&test.store, 1_000 * USDC);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    let config = test.client().get_config();
    test.set_time(end_at + config.buyout_window_seconds - 1);

    test.client().store_buyout(&loan_id);
    assert_eq!(
        test.client().get_loan(&loan_id).status,
        LoanStatus::BoughtOut
    );
}

#[test]
fn store_buyout_rejects_at_window_end() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    let config = test.client().get_config();
    test.set_time(end_at + config.buyout_window_seconds);

    assert_eq!(
        contract_error(test.client().try_store_buyout(&loan_id)),
        Error::BuyoutWindowClosed
    );
}

#[test]
fn claim_rejects_at_end_minus_one() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    test.set_time(end_at - 1);
    assert_eq!(
        contract_error(test.client().try_claim_rug(&loan_id)),
        Error::BuyoutWindowOpen
    );
}

#[test]
fn claim_rejects_at_end() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    test.set_time(end_at);
    assert_eq!(
        contract_error(test.client().try_claim_rug(&loan_id)),
        Error::BuyoutWindowOpen
    );
}

#[test]
fn claim_rejects_at_window_end_minus_one() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    let config = test.client().get_config();
    test.set_time(end_at + config.buyout_window_seconds - 1);
    assert_eq!(
        contract_error(test.client().try_claim_rug(&loan_id)),
        Error::BuyoutWindowOpen
    );
}

#[test]
fn claim_allowed_at_window_end() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    let config = test.client().get_config();
    test.set_time(end_at + config.buyout_window_seconds);

    test.client().claim_rug(&loan_id);

    assert_eq!(test.balance(&test.investor), 9_445 * USDC);
    assert_eq!(test.balance(&test.store), 9 * USDC);
    assert_eq!(test.balance(&test.contract), 0);
    assert_eq!(test.client().get_loan(&loan_id).status, LoanStatus::Claimed);
    let rug = test.client().get_rug(&test.rug_id);
    assert_eq!(rug.owner, test.investor);
    assert_eq!(rug.status, RugStatus::Free);
    let store = test.client().get_store(&test.store);
    assert!(store.frozen);
    assert_eq!(store.open_principal, 0);
    assert_eq!(test.client().get_credit(&test.investor), 0);
}

#[test]
fn claim_emits_missed_buyout_freeze_and_rug_claimed_events() {
    let test = TestEnv::with_config(1_000 * USDC, 0, 0, 0, 12, 60, 60);
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    let config = test.client().get_config();
    test.set_time(end_at + config.buyout_window_seconds);

    test.client().claim_rug(&loan_id);

    let expected_frozen = StoreFrozen {
        store: test.store.clone(),
        reason: FrozenReason::MissedBuyout,
    }
    .to_xdr(&test.env, &test.contract);
    let expected_claimed = RugClaimed {
        loan_id,
        rug_id: test.rug_id,
        investor: test.investor.clone(),
        store: test.store.clone(),
        interest: 0,
    }
    .to_xdr(&test.env, &test.contract);
    let events = test.env.events().all().filter_by_contract(&test.contract);
    assert_eq!(events.events(), &[expected_frozen, expected_claimed]);
}

#[test]
fn repay_still_allowed_after_window_before_claim() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    let config = test.client().get_config();
    test.set_time(end_at + config.buyout_window_seconds);

    test.client().repay(&loan_id);
    assert_eq!(test.client().get_loan(&loan_id).status, LoanStatus::Repaid);
}

#[test]
fn repay_after_buyout_is_rejected() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    test.mint_usdc(&test.store, 1_000 * USDC);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    test.set_time(end_at);
    test.client().store_buyout(&loan_id);

    assert_eq!(
        contract_error(test.client().try_repay(&loan_id)),
        Error::LoanSettled
    );
}

#[test]
fn repay_after_claim_is_rejected() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    let config = test.client().get_config();
    test.set_time(end_at + config.buyout_window_seconds);
    test.client().claim_rug(&loan_id);

    assert_eq!(
        contract_error(test.client().try_repay(&loan_id)),
        Error::LoanSettled
    );
}

#[test]
fn claim_after_buyout_is_rejected() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    test.mint_usdc(&test.store, 1_000 * USDC);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    test.set_time(end_at);
    test.client().store_buyout(&loan_id);

    assert_eq!(
        contract_error(test.client().try_claim_rug(&loan_id)),
        Error::LoanSettled
    );
}

#[test]
fn buyout_after_claim_is_rejected() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    let config = test.client().get_config();
    test.set_time(end_at + config.buyout_window_seconds);
    test.client().claim_rug(&loan_id);

    assert_eq!(
        contract_error(test.client().try_store_buyout(&loan_id)),
        Error::LoanSettled
    );
}

#[test]
fn buyout_and_claim_on_requested_loan_are_rejected() {
    let test = TestEnv::new();
    let loan_id = test.request(test.rug_id, 6);

    assert_eq!(
        contract_error(test.client().try_store_buyout(&loan_id)),
        Error::LoanNotFunded
    );
    assert_eq!(
        contract_error(test.client().try_claim_rug(&loan_id)),
        Error::LoanNotFunded
    );
}

#[test]
fn store_buyout_and_claim_require_the_correct_signer() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();

    test.env.set_auths(&[]);
    test.set_time(end_at);
    assert!(test.client().try_store_buyout(&loan_id).is_err());

    let config = test.client().get_config();
    test.set_time(end_at + config.buyout_window_seconds);
    assert!(test.client().try_claim_rug(&loan_id).is_err());
}

#[test]
fn store_buyout_allowed_while_store_frozen() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    test.client().freeze_store(&test.store);
    test.mint_usdc(&test.store, 1_000 * USDC);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    test.set_time(end_at);

    test.client().store_buyout(&loan_id);
    assert_eq!(
        test.client().get_loan(&loan_id).status,
        LoanStatus::BoughtOut
    );
}

#[test]
fn mint_rug_rejects_registered_stores_as_weaver() {
    let test = TestEnv::new();
    let client = test.client();
    let store2 = Address::generate(&test.env);
    client.register_store(&store2, &(1_000 * USDC));

    let store_before = client.get_store(&test.store);
    let next_before = client.next_rug_id();

    assert_eq!(
        contract_error(client.try_mint_rug(
            &test.store,
            &test.store,
            &String::from_str(&test.env, "Self mint"),
            &(100 * USDC),
        )),
        Error::WeaverIsStore
    );
    assert_eq!(
        contract_error(client.try_mint_rug(
            &test.store,
            &store2,
            &String::from_str(&test.env, "Other store"),
            &(100 * USDC),
        )),
        Error::WeaverIsStore
    );

    assert_eq!(client.next_rug_id(), next_before);
    assert_eq!(client.get_store(&test.store), store_before);
    assert_eq!(
        contract_error(client.try_get_rug(&next_before)),
        Error::RugNotFound
    );

    let ordinary = Address::generate(&test.env);
    let rug_id = client.mint_rug(
        &test.store,
        &ordinary,
        &String::from_str(&test.env, "Ordinary holder"),
        &(100 * USDC),
    );
    assert_eq!(rug_id, next_before);
    assert_eq!(client.get_rug(&rug_id).owner, ordinary);
}

#[test]
fn store_cannot_borrow_a_rug_it_bought_out() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    test.mint_usdc(&test.store, 1_000 * USDC);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    test.set_time(end_at);
    test.client().store_buyout(&loan_id);

    let store_before = test.client().get_store(&test.store);
    let rug_before = test.client().get_rug(&test.rug_id);
    let next_before = test.client().next_loan_id();
    assert_eq!(rug_before.owner, test.store);
    assert_eq!(rug_before.status, RugStatus::Free);

    assert_eq!(
        contract_error(
            test.client()
                .try_request_loan(&test.store, &test.rug_id, &6)
        ),
        Error::StoreCannotBorrow
    );

    assert_eq!(test.client().get_store(&test.store), store_before);
    assert_eq!(test.client().get_rug(&test.rug_id), rug_before);
    assert_eq!(test.client().next_loan_id(), next_before);
    assert_eq!(
        test.client().get_loan(&loan_id).status,
        LoanStatus::BoughtOut
    );
}

#[test]
fn store_cannot_borrow_a_rug_claimed_from_another_store() {
    let test = TestEnv::new();
    let store2 = Address::generate(&test.env);
    test.client().register_store(&store2, &(1_000 * USDC));
    test.mint_usdc(&store2, 10_000 * USDC);

    let loan_id = test.request(test.rug_id, 6);
    test.client().fund_loan(&store2, &loan_id);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    let config = test.client().get_config();
    test.set_time(end_at + config.buyout_window_seconds);
    test.client().claim_rug(&loan_id);

    let store_before = test.client().get_store(&store2);
    let rug_before = test.client().get_rug(&test.rug_id);
    let next_before = test.client().next_loan_id();
    assert_eq!(rug_before.owner, store2);
    assert_eq!(rug_before.status, RugStatus::Free);

    assert_eq!(
        contract_error(test.client().try_request_loan(&store2, &test.rug_id, &6)),
        Error::StoreCannotBorrow
    );

    assert_eq!(test.client().get_store(&store2), store_before);
    assert_eq!(test.client().get_rug(&test.rug_id), rug_before);
    assert_eq!(test.client().next_loan_id(), next_before);
}

#[test]
fn fund_loan_rejects_the_weaver_and_the_store_as_investor() {
    let test = TestEnv::new();
    let loan_id = test.request(test.rug_id, 6);

    let store_before = test.client().get_store(&test.store);
    let loan_before = test.client().get_loan(&loan_id);
    let rug_before = test.client().get_rug(&test.rug_id);
    let weaver_before = test.balance(&test.weaver);
    let store_balance_before = test.balance(&test.store);
    let contract_before = test.balance(&test.contract);

    assert_eq!(
        contract_error(test.client().try_fund_loan(&test.weaver, &loan_id)),
        Error::InvestorIsParty
    );
    assert_eq!(
        contract_error(test.client().try_fund_loan(&test.store, &loan_id)),
        Error::InvestorIsParty
    );

    assert_eq!(test.client().get_store(&test.store), store_before);
    assert_eq!(test.client().get_loan(&loan_id), loan_before);
    assert_eq!(test.client().get_rug(&test.rug_id), rug_before);
    assert_eq!(test.balance(&test.weaver), weaver_before);
    assert_eq!(test.balance(&test.store), store_balance_before);
    assert_eq!(test.balance(&test.contract), contract_before);
}

#[test]
fn fund_loan_allows_a_different_store_and_the_admin() {
    let test = TestEnv::with_config(2_000 * USDC, 1500, 100, 25, 12, 60, 60);
    let store2 = Address::generate(&test.env);
    test.client().register_store(&store2, &(2_000 * USDC));
    test.mint_usdc(&store2, 1_000 * USDC);
    test.mint_usdc(&test.admin, 1_000 * USDC);

    let first = test.request(test.rug_id, 6);
    test.client().fund_loan(&store2, &first);
    assert_eq!(test.client().get_loan(&first).status, LoanStatus::Funded);

    let second_rug = test.mint_rug(500 * USDC);
    let second = test.request(second_rug, 6);
    test.client().fund_loan(&test.admin, &second);
    assert_eq!(test.client().get_loan(&second).status, LoanStatus::Funded);
}

#[test]
fn store_can_redeem_a_rug_it_bought_out_as_the_only_signer() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    test.mint_usdc(&test.store, 1_000 * USDC);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    test.set_time(end_at);
    test.client().store_buyout(&loan_id);
    assert_eq!(test.client().get_rug(&test.rug_id).owner, test.store);

    test.env.set_auths(&[]);
    let invoke = MockAuthInvoke {
        contract: &test.contract,
        fn_name: "redeem",
        args: (&test.store, test.rug_id).into_val(&test.env),
        sub_invokes: &[],
    };
    test.env.mock_auths(&[MockAuth {
        address: &test.store,
        invoke: &invoke,
    }]);

    test.client().redeem(&test.store, &test.rug_id);
    assert_eq!(
        test.client().get_rug(&test.rug_id).status,
        RugStatus::Redeemed
    );
}

#[test]
fn repay_credits_and_withdraw_credit_pays_once() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let quote = test.client().quote(&(600 * USDC), &6);
    let expected = quote.investor_payout;
    let investor_before = test.balance(&test.investor);
    let contract_before = test.balance(&test.contract);

    test.set_authorized(&test.investor, false);
    test.client().repay(&loan_id);

    assert_eq!(test.client().get_loan(&loan_id).status, LoanStatus::Repaid);
    let rug = test.client().get_rug(&test.rug_id);
    assert_eq!(rug.owner, test.weaver);
    assert_eq!(rug.status, RugStatus::Free);
    assert_eq!(test.client().get_store(&test.store).open_principal, 0);
    assert_eq!(test.client().get_credit(&test.investor), expected);
    assert_eq!(test.balance(&test.investor), investor_before);
    assert_eq!(test.balance(&test.contract), contract_before + 600 * USDC);
    assert_eq!(
        test.balance(&test.contract),
        test.client().get_credit(&test.investor)
    );

    test.set_authorized(&test.investor, true);
    let paid = test.client().withdraw_credit(&test.investor);
    assert_eq!(paid, expected);
    assert_eq!(test.client().get_credit(&test.investor), 0);
    assert_eq!(test.balance(&test.investor), investor_before + expected);
    assert_eq!(test.balance(&test.contract), 0);
    assert_eq!(
        contract_error(test.client().try_withdraw_credit(&test.investor)),
        Error::NothingToWithdraw
    );
}

#[test]
fn store_buyout_credits_investor_when_transfer_fails() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let quote = test.client().quote(&(600 * USDC), &6);
    let expected = quote.investor_payout;
    test.mint_usdc(&test.store, 1_000 * USDC);
    let investor_before = test.balance(&test.investor);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();

    test.set_authorized(&test.investor, false);
    test.set_time(end_at);
    test.client().store_buyout(&loan_id);

    assert_eq!(
        test.client().get_loan(&loan_id).status,
        LoanStatus::BoughtOut
    );
    let rug = test.client().get_rug(&test.rug_id);
    assert_eq!(rug.owner, test.store);
    assert_eq!(rug.status, RugStatus::Free);
    assert_eq!(test.client().get_store(&test.store).open_principal, 0);
    assert_eq!(test.client().get_credit(&test.investor), expected);
    assert_eq!(test.balance(&test.investor), investor_before);
    assert_eq!(
        test.balance(&test.contract),
        test.client().get_credit(&test.investor)
    );
}

#[test]
fn claim_credits_investor_when_transfer_fails() {
    let test = TestEnv::new();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let quote = test.client().quote(&(600 * USDC), &6);
    let expected = quote.interest;
    let investor_before = test.balance(&test.investor);
    let end_at = test.client().get_loan(&loan_id).end_at.unwrap();
    let config = test.client().get_config();

    test.set_authorized(&test.investor, false);
    test.set_time(end_at + config.buyout_window_seconds);
    test.client().claim_rug(&loan_id);

    assert_eq!(test.client().get_loan(&loan_id).status, LoanStatus::Claimed);
    let rug = test.client().get_rug(&test.rug_id);
    assert_eq!(rug.owner, test.investor);
    assert_eq!(rug.status, RugStatus::Free);
    let store = test.client().get_store(&test.store);
    assert!(store.frozen);
    assert_eq!(store.open_principal, 0);
    assert_eq!(test.client().get_credit(&test.investor), expected);
    assert_eq!(test.balance(&test.investor), investor_before);
    assert_eq!(
        test.balance(&test.contract),
        test.client().get_credit(&test.investor)
    );
}

#[test]
fn conservation_counts_credit_as_held_by_contract() {
    let test = TestEnv::new();
    let holders = [
        &test.admin,
        &test.fee_recipient,
        &test.store,
        &test.weaver,
        &test.investor,
    ];
    let total_before: i128 = holders.iter().map(|address| test.balance(address)).sum();
    let loan_id = test.request_and_fund(test.rug_id, 6);
    let quote = test.client().quote(&(600 * USDC), &6);

    test.set_authorized(&test.investor, false);
    test.client().repay(&loan_id);

    let held: i128 = holders.iter().map(|address| test.balance(address)).sum();
    let contract_balance = test.balance(&test.contract);
    assert_eq!(held + contract_balance, total_before);
    assert_eq!(contract_balance, quote.investor_payout);
    assert_eq!(contract_balance, test.client().get_credit(&test.investor));

    test.set_authorized(&test.investor, true);
    test.client().withdraw_credit(&test.investor);

    let held_after: i128 = holders.iter().map(|address| test.balance(address)).sum();
    assert_eq!(held_after, total_before);
    assert_eq!(test.balance(&test.contract), 0);
    assert_eq!(test.client().get_credit(&test.investor), 0);
}

#[test]
fn emits_cancelled_and_redeemed_events() {
    let test = TestEnv::new();
    let client = test.client();

    let loan_id = test.request(test.rug_id, 6);
    client.cancel_request(&loan_id);
    let expected_cancel = LoanCancelled {
        loan_id,
        rug_id: test.rug_id,
        weaver: test.weaver.clone(),
    }
    .to_xdr(&test.env, &test.contract);
    let cancelled = test.env.events().all().filter_by_contract(&test.contract);
    assert_eq!(cancelled.events(), &[expected_cancel]);

    client.redeem(&test.weaver, &test.rug_id);
    let expected_redeem = RugRedeemed {
        rug_id: test.rug_id,
        store: test.store.clone(),
        holder: test.weaver.clone(),
    }
    .to_xdr(&test.env, &test.contract);
    let redeemed = test.env.events().all().filter_by_contract(&test.contract);
    assert_eq!(redeemed.events(), &[expected_redeem]);
}

#[test]
fn emits_rug_minted_and_loan_requested_events() {
    let test = TestEnv::new();
    let client = test.client();

    let rug_id = client.mint_rug(
        &test.store,
        &test.weaver,
        &String::from_str(&test.env, "Event rug"),
        &(250 * USDC),
    );
    let expected_mint = RugMinted {
        rug_id,
        store: test.store.clone(),
        weaver: test.weaver.clone(),
        description: String::from_str(&test.env, "Event rug"),
        price: 250 * USDC,
    }
    .to_xdr(&test.env, &test.contract);
    let minted = test.env.events().all().filter_by_contract(&test.contract);
    assert_eq!(minted.events(), &[expected_mint]);

    let loan_id = client.request_loan(&test.weaver, &rug_id, &6);
    let expected_requested = LoanRequested {
        loan_id,
        rug_id,
        store: test.store.clone(),
        weaver: test.weaver.clone(),
        principal: 250 * USDC,
        months: 6,
    }
    .to_xdr(&test.env, &test.contract);
    let requested = test.env.events().all().filter_by_contract(&test.contract);
    assert_eq!(requested.events(), &[expected_requested]);
}

#[test]
fn emits_store_frozen_event() {
    let test = TestEnv::new();
    test.client().freeze_store(&test.store);
    let expected = StoreFrozen {
        store: test.store.clone(),
        reason: FrozenReason::Platform,
    }
    .to_xdr(&test.env, &test.contract);
    let events = test.env.events().all().filter_by_contract(&test.contract);
    assert_eq!(events.events(), &[expected]);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rejects_unrepresentable_default_window() {
    TestEnv::with_config(1_000 * USDC, 1500, 100, 25, 12, 60, u64::MAX);
}

#[test]
fn funding_checks_full_claim_deadline_before_moving_money() {
    let t = TestEnv::new();
    let loan = t.request(t.rug_id, 1);
    t.set_time(u64::MAX - 100); // end fits; end + buy-out window does not.
    let before = t.balance(&t.investor);
    assert_eq!(
        contract_error(t.client().try_fund_loan(&t.investor, &loan)),
        Error::InvalidAmount
    );
    assert_eq!(t.balance(&t.investor), before);
    assert_eq!(t.balance(&t.contract), 0);
    assert_eq!(t.client().get_loan(&loan).status, LoanStatus::Requested);
    assert_eq!(t.client().get_rug(&t.rug_id).status, RugStatus::Requested);
}

#[test]
fn registered_stores_are_discoverable_without_rugs_or_event_history() {
    let t = TestEnv::new();
    let second = Address::generate(&t.env);
    assert_eq!(t.client().store_count(), 1);
    t.client().register_store(&second, &(1_000 * USDC));
    assert_eq!(t.client().store_count(), 2);
    assert_eq!(t.client().store_at(&0), t.store);
    assert_eq!(t.client().store_at(&1), second);
    t.client().freeze_store(&second);
    assert_eq!(t.client().store_at(&1), second);
    assert_eq!(
        contract_error(t.client().try_register_store(&second, &1)),
        Error::StoreAlreadyRegistered
    );
    assert_eq!(t.client().store_count(), 2);
    assert_eq!(
        contract_error(t.client().try_store_at(&2)),
        Error::StoreNotRegistered
    );
}

#[test]
fn failed_payer_does_not_create_credit_or_unlock_collateral() {
    let test = TestEnv::new();
    let loan = test.request_and_fund(test.rug_id, 6);
    test.set_authorized(&test.investor, false);
    test.set_authorized(&test.weaver, false);
    assert!(test.client().try_repay(&loan).is_err());
    assert_eq!(test.client().get_credit(&test.investor), 0);
    assert_eq!(test.balance(&test.contract), 45 * USDC);
    assert_eq!(test.client().get_loan(&loan).status, LoanStatus::Funded);
    assert_eq!(
        test.client().get_rug(&test.rug_id).status,
        RugStatus::Locked
    );
    assert_eq!(
        test.client().get_store(&test.store).open_principal,
        600 * USDC
    );
}

#[test]
fn credit_accumulates_and_does_not_spend_other_loan_interest() {
    let test = TestEnv::with_config(3000 * USDC, 1500, 100, 25, 12, 60, 60);
    let rug_two = test.mint_rug(600 * USDC);
    let rug_three = test.mint_rug(600 * USDC);
    let first = test.request_and_fund(test.rug_id, 6);
    let second = test.request_and_fund(rug_two, 1);
    let third = test.request_and_fund(rug_three, 1);
    test.set_authorized(&test.investor, false);
    test.client().repay(&first);
    test.client().repay(&second);
    assert_eq!(test.client().get_credit(&test.investor), 12525 * USDC / 10);
    assert_eq!(test.balance(&test.contract), 1260 * USDC);
    assert_eq!(test.client().get_loan(&third).status, LoanStatus::Funded);
    test.set_authorized(&test.investor, true);
    assert_eq!(
        test.client().withdraw_credit(&test.investor),
        12525 * USDC / 10
    );
    assert_eq!(test.client().get_credit(&test.investor), 0);
    assert_eq!(test.balance(&test.contract), 75 * USDC / 10);
    test.client().repay(&third);
    assert_eq!(test.balance(&test.contract), 0);
    assert_eq!(test.client().get_credit(&test.investor), 0);
}

#[test]
fn failed_credit_withdrawal_and_unauthorized_call_are_atomic() {
    let test = TestEnv::new();
    let loan = test.request_and_fund(test.rug_id, 6);
    test.set_authorized(&test.investor, false);
    test.client().repay(&loan);
    let investor_before = test.balance(&test.investor);
    assert!(test.client().try_withdraw_credit(&test.investor).is_err());
    assert_eq!(test.client().get_credit(&test.investor), 645 * USDC);
    assert_eq!(test.balance(&test.contract), 645 * USDC);
    assert_eq!(test.balance(&test.investor), investor_before);
    test.set_authorized(&test.investor, true);
    test.env.set_auths(&[]);
    assert!(test.client().try_withdraw_credit(&test.investor).is_err());
    assert_eq!(test.client().get_credit(&test.investor), 645 * USDC);
    assert_eq!(test.balance(&test.contract), 645 * USDC);
    assert_eq!(test.balance(&test.investor), investor_before);
}
