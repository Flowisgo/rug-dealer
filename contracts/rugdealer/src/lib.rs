#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env, String,
};

const BPS_DENOM: i128 = 10_000;
const MONTHS_PER_YEAR: i128 = 12;
const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND_TO: u32 = 200_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub usdc: Address,
    pub fee_recipient: Address,
    pub interest_bps_per_year: u32,
    pub platform_fee_bps: u32,
    pub store_fee_bps_per_month: u32,
    pub max_months: u32,
    pub month_seconds: u64,
    pub buyout_window_seconds: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Store {
    pub address: Address,
    pub limit: i128,
    pub open_principal: i128,
    pub frozen: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RugStatus {
    Free,
    Requested,
    Locked,
    Redeemed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Rug {
    pub id: u64,
    pub store: Address,
    pub description: String,
    pub price: i128,
    pub owner: Address,
    pub status: RugStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LoanStatus {
    Requested,
    Funded,
    Cancelled,
    Repaid,
    BoughtOut,
    Claimed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Loan {
    pub id: u64,
    pub rug_id: u64,
    pub store: Address,
    pub weaver: Address,
    pub investor: Option<Address>,
    pub principal: i128,
    pub months: u32,
    pub interest: i128,
    pub platform_fee: i128,
    pub store_fee: i128,
    pub weaver_payout: i128,
    pub requested_at: u64,
    pub funded_at: Option<u64>,
    pub end_at: Option<u64>,
    pub status: LoanStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Quote {
    pub principal: i128,
    pub months: u32,
    pub interest: i128,
    pub platform_fee: i128,
    pub store_fee: i128,
    pub weaver_payout: i128,
    pub investor_payout: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FrozenReason {
    Platform,
    MissedBuyout,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    NextRugId,
    NextLoanId,
    Store(Address),
    Rug(u64),
    Loan(u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    InvalidConfig = 1,
    StoreAlreadyRegistered = 2,
    StoreNotRegistered = 3,
    StoreFrozen = 4,
    InvalidLimit = 5,
    InvalidPrice = 6,
    InvalidMonths = 7,
    InvalidDescription = 8,
    InvalidAmount = 9,
    RugNotFound = 10,
    RugNotFree = 11,
    NotRugOwner = 12,
    StoreLimitExceeded = 13,
    LoanNotFound = 14,
    LoanNotRequested = 15,
    LoanNotFunded = 16,
    LoanSettled = 17,
    TooEarly = 18,
    BuyoutWindowClosed = 19,
    BuyoutWindowOpen = 20,
    InvalidState = 21,
}

#[contractevent]
pub struct StoreRegistered {
    #[topic]
    pub store: Address,
    pub limit: i128,
}

#[contractevent]
pub struct StoreLimitSet {
    #[topic]
    pub store: Address,
    pub limit: i128,
}

#[contractevent]
pub struct StoreFrozen {
    #[topic]
    pub store: Address,
    pub reason: FrozenReason,
}

#[contractevent]
pub struct RugMinted {
    #[topic]
    pub rug_id: u64,
    pub store: Address,
    pub weaver: Address,
    pub description: String,
    pub price: i128,
}

#[contractevent]
pub struct LoanRequested {
    #[topic]
    pub loan_id: u64,
    pub rug_id: u64,
    pub store: Address,
    pub weaver: Address,
    pub principal: i128,
    pub months: u32,
}

#[contractevent]
pub struct LoanCancelled {
    #[topic]
    pub loan_id: u64,
    pub rug_id: u64,
    pub weaver: Address,
}

#[contractevent]
pub struct LoanFunded {
    #[topic]
    pub loan_id: u64,
    pub rug_id: u64,
    pub investor: Address,
    pub principal: i128,
    pub interest: i128,
    pub platform_fee: i128,
    pub store_fee: i128,
    pub weaver_payout: i128,
    pub end_at: u64,
}

#[contractevent]
pub struct LoanRepaid {
    #[topic]
    pub loan_id: u64,
    pub rug_id: u64,
    pub weaver: Address,
    pub investor: Address,
    pub principal: i128,
    pub interest: i128,
}

#[contractevent]
pub struct RugRedeemed {
    #[topic]
    pub rug_id: u64,
    pub store: Address,
    pub holder: Address,
}

#[contract]
pub struct RugDealer;

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn config(env: &Env) -> Config {
    bump_instance(env);
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidConfig))
}

fn next_id(env: &Env, key: DataKey) -> u64 {
    let id = env.storage().instance().get(&key).unwrap_or(1);
    env.storage().instance().set(&key, &(id + 1));
    bump_instance(env);
    id
}

fn get_store(env: &Env, store: &Address) -> Result<Store, Error> {
    let key = DataKey::Store(store.clone());
    let value = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::StoreNotRegistered)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    Ok(value)
}

fn save_store(env: &Env, store: &Store) {
    let key = DataKey::Store(store.address.clone());
    env.storage().persistent().set(&key, store);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn get_rug(env: &Env, rug_id: u64) -> Result<Rug, Error> {
    let key = DataKey::Rug(rug_id);
    let value = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::RugNotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    Ok(value)
}

fn save_rug(env: &Env, rug: &Rug) {
    let key = DataKey::Rug(rug.id);
    env.storage().persistent().set(&key, rug);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn get_loan(env: &Env, loan_id: u64) -> Result<Loan, Error> {
    let key = DataKey::Loan(loan_id);
    let value = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::LoanNotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    Ok(value)
}

fn save_loan(env: &Env, loan: &Loan) {
    let key = DataKey::Loan(loan.id);
    env.storage().persistent().set(&key, loan);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn calculate_quote(cfg: &Config, principal: i128, months: u32) -> Result<Quote, Error> {
    if principal <= 0 {
        return Err(Error::InvalidAmount);
    }
    if months == 0 || months > cfg.max_months {
        return Err(Error::InvalidMonths);
    }

    let months_i128 = months as i128;
    let interest = principal
        .checked_mul(cfg.interest_bps_per_year as i128)
        .and_then(|v| v.checked_mul(months_i128))
        .ok_or(Error::InvalidAmount)?
        / (BPS_DENOM * MONTHS_PER_YEAR);
    let platform_fee = principal
        .checked_mul(cfg.platform_fee_bps as i128)
        .ok_or(Error::InvalidAmount)?
        / BPS_DENOM;
    let store_fee = principal
        .checked_mul(cfg.store_fee_bps_per_month as i128)
        .and_then(|v| v.checked_mul(months_i128))
        .ok_or(Error::InvalidAmount)?
        / BPS_DENOM;
    let total_fee = interest
        .checked_add(platform_fee)
        .and_then(|v| v.checked_add(store_fee))
        .ok_or(Error::InvalidAmount)?;
    let weaver_payout = principal
        .checked_sub(total_fee)
        .ok_or(Error::InvalidAmount)?;
    let investor_payout = principal
        .checked_add(interest)
        .ok_or(Error::InvalidAmount)?;

    Ok(Quote {
        principal,
        months,
        interest,
        platform_fee,
        store_fee,
        weaver_payout,
        investor_payout,
    })
}

#[contractimpl]
impl RugDealer {
    pub fn __constructor(
        env: Env,
        admin: Address,
        usdc: Address,
        fee_recipient: Address,
        interest_bps_per_year: u32,
        platform_fee_bps: u32,
        store_fee_bps_per_month: u32,
        max_months: u32,
        month_seconds: u64,
        buyout_window_seconds: u64,
    ) {
        if month_seconds == 0
            || buyout_window_seconds == 0
            || max_months == 0
            || max_months > 12
            || interest_bps_per_year > BPS_DENOM as u32
            || platform_fee_bps > BPS_DENOM as u32
            || store_fee_bps_per_month > BPS_DENOM as u32
        {
            panic_with_error!(&env, Error::InvalidConfig);
        }

        let max_fee_bps = (interest_bps_per_year as u64 * max_months as u64) / 12
            + platform_fee_bps as u64
            + (store_fee_bps_per_month as u64 * max_months as u64);
        if max_fee_bps >= BPS_DENOM as u64 {
            panic_with_error!(&env, Error::InvalidConfig);
        }

        if token::Client::new(&env, &usdc).decimals() != 7 {
            panic_with_error!(&env, Error::InvalidConfig);
        }

        let cfg = Config {
            admin,
            usdc,
            fee_recipient,
            interest_bps_per_year,
            platform_fee_bps,
            store_fee_bps_per_month,
            max_months,
            month_seconds,
            buyout_window_seconds,
        };
        env.storage().instance().set(&DataKey::Config, &cfg);
        env.storage().instance().set(&DataKey::NextRugId, &1u64);
        env.storage().instance().set(&DataKey::NextLoanId, &1u64);
        bump_instance(&env);
    }

    pub fn register_store(env: Env, store: Address, limit: i128) -> Result<(), Error> {
        let cfg = config(&env);
        cfg.admin.require_auth();

        if limit < 0 {
            return Err(Error::InvalidLimit);
        }
        let key = DataKey::Store(store.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::StoreAlreadyRegistered);
        }

        let value = Store {
            address: store.clone(),
            limit,
            open_principal: 0,
            frozen: false,
        };
        save_store(&env, &value);
        StoreRegistered { store, limit }.publish(&env);
        Ok(())
    }

    pub fn set_store_limit(env: Env, store: Address, limit: i128) -> Result<(), Error> {
        let cfg = config(&env);
        cfg.admin.require_auth();

        if limit < 0 {
            return Err(Error::InvalidLimit);
        }
        let mut value = get_store(&env, &store)?;
        value.limit = limit;
        save_store(&env, &value);
        StoreLimitSet { store, limit }.publish(&env);
        Ok(())
    }

    pub fn freeze_store(env: Env, store: Address) -> Result<(), Error> {
        let cfg = config(&env);
        cfg.admin.require_auth();

        let mut value = get_store(&env, &store)?;
        if !value.frozen {
            value.frozen = true;
            save_store(&env, &value);
            StoreFrozen {
                store,
                reason: FrozenReason::Platform,
            }
            .publish(&env);
        }
        Ok(())
    }

    pub fn mint_rug(
        env: Env,
        store: Address,
        weaver: Address,
        description: String,
        price: i128,
    ) -> Result<u64, Error> {
        store.require_auth();

        let value = get_store(&env, &store)?;
        if value.frozen {
            return Err(Error::StoreFrozen);
        }
        if price <= 0 {
            return Err(Error::InvalidPrice);
        }
        let description_len = description.len();
        if description_len == 0 || description_len > 280 {
            return Err(Error::InvalidDescription);
        }

        let rug_id = next_id(&env, DataKey::NextRugId);
        let rug = Rug {
            id: rug_id,
            store: store.clone(),
            description: description.clone(),
            price,
            owner: weaver.clone(),
            status: RugStatus::Free,
        };
        save_rug(&env, &rug);
        RugMinted {
            rug_id,
            store,
            weaver,
            description,
            price,
        }
        .publish(&env);
        Ok(rug_id)
    }

    pub fn request_loan(env: Env, weaver: Address, rug_id: u64, months: u32) -> Result<u64, Error> {
        weaver.require_auth();
        let cfg = config(&env);

        let mut rug = get_rug(&env, rug_id)?;
        if rug.owner != weaver {
            return Err(Error::NotRugOwner);
        }
        if rug.status != RugStatus::Free {
            return Err(Error::RugNotFree);
        }
        if months == 0 || months > cfg.max_months {
            return Err(Error::InvalidMonths);
        }

        let quote = calculate_quote(&cfg, rug.price, months)?;
        let mut store = get_store(&env, &rug.store)?;
        let new_open_principal = store
            .open_principal
            .checked_add(rug.price)
            .ok_or(Error::InvalidAmount)?;
        if new_open_principal > store.limit {
            return Err(Error::StoreLimitExceeded);
        }

        store.open_principal = new_open_principal;
        save_store(&env, &store);

        let loan_id = next_id(&env, DataKey::NextLoanId);
        let loan = Loan {
            id: loan_id,
            rug_id,
            store: rug.store.clone(),
            weaver: weaver.clone(),
            investor: None,
            principal: rug.price,
            months,
            interest: quote.interest,
            platform_fee: quote.platform_fee,
            store_fee: quote.store_fee,
            weaver_payout: quote.weaver_payout,
            requested_at: env.ledger().timestamp(),
            funded_at: None,
            end_at: None,
            status: LoanStatus::Requested,
        };
        rug.status = RugStatus::Requested;
        save_rug(&env, &rug);
        save_loan(&env, &loan);

        LoanRequested {
            loan_id,
            rug_id,
            store: loan.store,
            weaver,
            principal: loan.principal,
            months,
        }
        .publish(&env);
        Ok(loan_id)
    }

    pub fn cancel_request(env: Env, loan_id: u64) -> Result<(), Error> {
        let mut loan = get_loan(&env, loan_id)?;
        loan.weaver.require_auth();
        if loan.status != LoanStatus::Requested {
            return Err(Error::LoanNotRequested);
        }

        let mut rug = get_rug(&env, loan.rug_id)?;
        if rug.status != RugStatus::Requested {
            return Err(Error::InvalidState);
        }
        let mut store = get_store(&env, &loan.store)?;
        store.open_principal = store
            .open_principal
            .checked_sub(loan.principal)
            .ok_or(Error::InvalidState)?;

        rug.status = RugStatus::Free;
        loan.status = LoanStatus::Cancelled;
        save_store(&env, &store);
        save_rug(&env, &rug);
        save_loan(&env, &loan);

        LoanCancelled {
            loan_id,
            rug_id: loan.rug_id,
            weaver: loan.weaver,
        }
        .publish(&env);
        Ok(())
    }

    pub fn fund_loan(env: Env, investor: Address, loan_id: u64) -> Result<(), Error> {
        investor.require_auth();
        let cfg = config(&env);

        let mut loan = get_loan(&env, loan_id)?;
        if loan.status != LoanStatus::Requested {
            return Err(Error::LoanNotRequested);
        }

        let mut rug = get_rug(&env, loan.rug_id)?;
        if rug.status != RugStatus::Requested {
            return Err(Error::InvalidState);
        }

        let store = get_store(&env, &loan.store)?;
        if store.open_principal > store.limit {
            return Err(Error::StoreLimitExceeded);
        }

        let now = env.ledger().timestamp();
        let duration = (loan.months as u64)
            .checked_mul(cfg.month_seconds)
            .ok_or(Error::InvalidAmount)?;
        let end_at = now.checked_add(duration).ok_or(Error::InvalidAmount)?;

        loan.investor = Some(investor.clone());
        loan.funded_at = Some(now);
        loan.end_at = Some(end_at);
        loan.status = LoanStatus::Funded;
        rug.status = RugStatus::Locked;
        save_loan(&env, &loan);
        save_rug(&env, &rug);

        let usdc = token::Client::new(&env, &cfg.usdc);
        let contract = env.current_contract_address();
        usdc.transfer(&investor, &contract, &loan.principal);
        if loan.weaver_payout > 0 {
            usdc.transfer(&contract, &loan.weaver, &loan.weaver_payout);
        }
        if loan.store_fee > 0 {
            usdc.transfer(&contract, &loan.store, &loan.store_fee);
        }
        if loan.platform_fee > 0 {
            usdc.transfer(&contract, &cfg.fee_recipient, &loan.platform_fee);
        }

        LoanFunded {
            loan_id,
            rug_id: loan.rug_id,
            investor,
            principal: loan.principal,
            interest: loan.interest,
            platform_fee: loan.platform_fee,
            store_fee: loan.store_fee,
            weaver_payout: loan.weaver_payout,
            end_at,
        }
        .publish(&env);
        Ok(())
    }

    pub fn repay(env: Env, loan_id: u64) -> Result<(), Error> {
        let cfg = config(&env);
        let mut loan = get_loan(&env, loan_id)?;
        loan.weaver.require_auth();
        if loan.status != LoanStatus::Funded {
            return Err(Error::LoanNotFunded);
        }

        let mut rug = get_rug(&env, loan.rug_id)?;
        if rug.status != RugStatus::Locked {
            return Err(Error::InvalidState);
        }
        let mut store = get_store(&env, &loan.store)?;
        store.open_principal = store
            .open_principal
            .checked_sub(loan.principal)
            .ok_or(Error::InvalidState)?;
        let investor = loan.investor.clone().ok_or(Error::InvalidState)?;
        let investor_payout = loan
            .principal
            .checked_add(loan.interest)
            .ok_or(Error::InvalidAmount)?;

        loan.status = LoanStatus::Repaid;
        rug.status = RugStatus::Free;
        save_store(&env, &store);
        save_rug(&env, &rug);
        save_loan(&env, &loan);

        let usdc = token::Client::new(&env, &cfg.usdc);
        let contract = env.current_contract_address();
        usdc.transfer(&loan.weaver, &contract, &loan.principal);
        usdc.transfer(&contract, &investor, &investor_payout);

        LoanRepaid {
            loan_id,
            rug_id: loan.rug_id,
            weaver: loan.weaver,
            investor,
            principal: loan.principal,
            interest: loan.interest,
        }
        .publish(&env);
        Ok(())
    }

    pub fn redeem(env: Env, holder: Address, rug_id: u64) -> Result<(), Error> {
        let mut rug = get_rug(&env, rug_id)?;
        holder.require_auth();
        rug.store.require_auth();

        if rug.owner != holder {
            return Err(Error::NotRugOwner);
        }
        if rug.status != RugStatus::Free {
            return Err(Error::RugNotFree);
        }

        rug.status = RugStatus::Redeemed;
        save_rug(&env, &rug);
        RugRedeemed {
            rug_id,
            store: rug.store,
            holder,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_config(env: Env) -> Config {
        config(&env)
    }

    pub fn get_store(env: Env, store: Address) -> Result<Store, Error> {
        get_store(&env, &store)
    }

    pub fn get_rug(env: Env, rug_id: u64) -> Result<Rug, Error> {
        get_rug(&env, rug_id)
    }

    pub fn get_loan(env: Env, loan_id: u64) -> Result<Loan, Error> {
        get_loan(&env, loan_id)
    }

    pub fn next_rug_id(env: Env) -> u64 {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::NextRugId)
            .unwrap_or(1)
    }

    pub fn next_loan_id(env: Env) -> u64 {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::NextLoanId)
            .unwrap_or(1)
    }

    pub fn quote(env: Env, principal: i128, months: u32) -> Result<Quote, Error> {
        let cfg = config(&env);
        calculate_quote(&cfg, principal, months)
    }

    pub fn is_overdue(env: Env, loan_id: u64) -> Result<bool, Error> {
        let loan = get_loan(&env, loan_id)?;
        if loan.status != LoanStatus::Funded {
            return Ok(false);
        }
        let end_at = loan.end_at.ok_or(Error::InvalidState)?;
        Ok(env.ledger().timestamp() >= end_at)
    }
}

mod test;
