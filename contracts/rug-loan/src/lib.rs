#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env,
};
pub const UNIT: i128 = 10_000_000;
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanTerms {
    pub advance: i128,
    pub lender_due: i128,
    pub custody_fee: i128,
    pub fallback_price: i128,
    pub duration_secs: u64,
    pub lender: Address,
    pub dealer: Address,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
// Keep the public ABI inline; Soroban contract values do not use Box indirection.
#[allow(clippy::large_enum_variant)]
pub enum Financing {
    Unaccepted,
    Accepted(LoanTerms),
}
impl Financing {
    fn accepted(&self) -> Result<LoanTerms, Error> {
        match self {
            Self::Accepted(t) => Ok(t.clone()),
            Self::Unaccepted => Err(Error::WrongStage),
        }
    }
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Defaults {
    pub advance: i128,
    pub lender_due: i128,
    pub custody_fee: i128,
    pub fallback_price: i128,
    pub duration_secs: u64,
}
#[contracttype]
#[derive(Clone)]
enum Key {
    Warehouse,
    Token,
    Receipt(BytesN<32>),
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Stage {
    Held,
    TermsAccepted,
    Active,
    Overdue,
    SaleSettled,
    Repaid,
    DealerPurchased,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Receipt {
    pub weaver: Address,
    pub terms: Financing,
    pub dealer_committed: bool,
    pub buyer: Option<Address>,
    pub pickup_recipient: Option<Address>,
    pub approved_price: Option<i128>,
    pub funded_at: Option<u64>,
    pub deadline: Option<u64>,
    pub stage: Stage,
    pub ready_for_pickup: bool,
}
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    ReceiptExists = 1,
    ReceiptMissing = 2,
    WrongStage = 3,
    PriceNotApproved = 4,
    InvalidAmount = 5,
    TermsMismatch = 6,
    DeadlinePassed = 7,
    TooEarly = 8,
    DealerNotCommitted = 9,
    InvalidDuration = 10,
}
#[contract]
pub struct RugLoan;
fn save(env: &Env, id: &BytesN<32>, r: &Receipt) {
    let key = Key::Receipt(id.clone());
    env.storage().persistent().set(&key, r);
    env.storage()
        .persistent()
        .extend_ttl(&key, 100_000, 200_000);
    env.storage().instance().extend_ttl(100_000, 200_000);
}
fn warehouse(env: &Env) -> Address {
    env.storage().instance().get(&Key::Warehouse).unwrap()
}
fn asset(env: &Env) -> Address {
    env.storage().instance().get(&Key::Token).unwrap()
}
fn total(t: &LoanTerms) -> Result<i128, Error> {
    t.lender_due
        .checked_add(t.custody_fee)
        .ok_or(Error::InvalidAmount)
}
fn validate(t: &LoanTerms) -> Result<(), Error> {
    if t.advance <= 0
        || t.lender_due < t.advance
        || t.custody_fee < 0
        || t.fallback_price < total(t)?
    {
        return Err(Error::InvalidAmount);
    }
    if !(30..=86400).contains(&t.duration_secs) {
        return Err(Error::InvalidDuration);
    }
    Ok(())
}
fn unsettled(r: &Receipt) -> Result<(), Error> {
    if r.stage != Stage::Active && r.stage != Stage::Overdue {
        return Err(Error::WrongStage);
    }
    Ok(())
}
fn settle(
    env: &Env,
    id: &BytesN<32>,
    mut r: Receipt,
    payer: Address,
    amount: i128,
    recipient: Address,
    stage: Stage,
) -> Result<(), Error> {
    let t = r.terms.accepted()?;
    let surplus = amount.checked_sub(total(&t)?).ok_or(Error::InvalidAmount)?;
    if surplus < 0 {
        return Err(Error::InvalidAmount);
    }
    let contract = env.current_contract_address();
    let token_id = asset(env);
    let token = token::Client::new(env, &token_id);
    token.transfer(&payer, &contract, &amount);
    token.transfer(&contract, &t.lender, &t.lender_due);
    if t.custody_fee > 0 {
        token.transfer(&contract, warehouse(env), &t.custody_fee);
    }
    if surplus > 0 {
        token.transfer(&contract, &r.weaver, &surplus);
    }
    r.buyer = if stage == Stage::Repaid {
        None
    } else {
        Some(recipient.clone())
    };
    r.pickup_recipient = Some(recipient);
    r.stage = stage;
    r.ready_for_pickup = true;
    save(env, id, &r);
    Ok(())
}
#[contractimpl]
impl RugLoan {
    pub fn __constructor(env: Env, warehouse: Address, token: Address) {
        assert_eq!(token::Client::new(&env, &token).decimals(), 7);
        env.storage().instance().set(&Key::Warehouse, &warehouse);
        env.storage().instance().set(&Key::Token, &token);
        env.storage().instance().extend_ttl(100_000, 200_000);
    }
    pub fn ledger_time(env: Env) -> u64 {
        env.ledger().timestamp()
    }

    pub fn loan_terms() -> Defaults {
        Defaults {
            advance: 8 * UNIT,
            lender_due: 9 * UNIT,
            custody_fee: UNIT,
            fallback_price: 10 * UNIT,
            duration_secs: 300,
        }
    }
    pub fn register_receipt(env: Env, id: BytesN<32>, weaver: Address) -> Result<(), Error> {
        warehouse(&env).require_auth();
        if env.storage().persistent().has(&Key::Receipt(id.clone())) {
            return Err(Error::ReceiptExists);
        }
        save(
            &env,
            &id,
            &Receipt {
                weaver,
                terms: Financing::Unaccepted,
                dealer_committed: false,
                buyer: None,
                pickup_recipient: None,
                approved_price: None,
                funded_at: None,
                deadline: None,
                stage: Stage::Held,
                ready_for_pickup: false,
            },
        );
        Ok(())
    }
    pub fn accept_terms(env: Env, id: BytesN<32>, terms: LoanTerms) -> Result<(), Error> {
        let mut r = Self::get_receipt(env.clone(), id.clone())?;
        r.weaver.require_auth();
        if r.stage != Stage::Held {
            return Err(Error::WrongStage);
        }
        validate(&terms)?;
        r.terms = Financing::Accepted(terms);
        r.stage = Stage::TermsAccepted;
        save(&env, &id, &r);
        Ok(())
    }
    pub fn accept_fallback(env: Env, id: BytesN<32>, terms: LoanTerms) -> Result<(), Error> {
        let mut r = Self::get_receipt(env.clone(), id.clone())?;
        if r.stage != Stage::TermsAccepted || r.dealer_committed {
            return Err(Error::WrongStage);
        }
        let accepted = r.terms.accepted()?;
        accepted.dealer.require_auth();
        if terms != accepted {
            return Err(Error::TermsMismatch);
        }
        r.dealer_committed = true;
        save(&env, &id, &r);
        Ok(())
    }
    pub fn fund_loan(env: Env, id: BytesN<32>) -> Result<(), Error> {
        let mut r = Self::get_receipt(env.clone(), id.clone())?;
        if r.stage != Stage::TermsAccepted {
            return Err(Error::WrongStage);
        }
        let t = r.terms.accepted()?;
        t.lender.require_auth();
        if !r.dealer_committed {
            return Err(Error::DealerNotCommitted);
        }
        let now = env.ledger().timestamp();
        let deadline = now
            .checked_add(t.duration_secs)
            .ok_or(Error::InvalidDuration)?;
        token::Client::new(&env, &asset(&env)).transfer(&t.lender, &r.weaver, &t.advance);
        r.funded_at = Some(now);
        r.deadline = Some(deadline);
        r.stage = Stage::Active;
        save(&env, &id, &r);
        Ok(())
    }
    pub fn approve_sale(env: Env, id: BytesN<32>, price: i128) -> Result<(), Error> {
        let mut r = Self::get_receipt(env.clone(), id.clone())?;
        r.weaver.require_auth();
        unsettled(&r)?;
        if r.stage == Stage::Overdue {
            return Err(Error::DeadlinePassed);
        }
        if price < total(&r.terms.accepted()?)? {
            return Err(Error::InvalidAmount);
        }
        r.approved_price = Some(price);
        save(&env, &id, &r);
        Ok(())
    }
    pub fn buy(env: Env, id: BytesN<32>, buyer: Address, payment: i128) -> Result<(), Error> {
        let r = Self::get_receipt(env.clone(), id.clone())?;
        buyer.require_auth();
        unsettled(&r)?;
        if r.stage == Stage::Overdue {
            return Err(Error::DeadlinePassed);
        }
        if payment != r.approved_price.ok_or(Error::PriceNotApproved)? {
            return Err(Error::InvalidAmount);
        }
        settle(
            &env,
            &id,
            r,
            buyer.clone(),
            payment,
            buyer,
            Stage::SaleSettled,
        )
    }
    pub fn repay(env: Env, id: BytesN<32>) -> Result<(), Error> {
        let r = Self::get_receipt(env.clone(), id.clone())?;
        r.weaver.require_auth();
        unsettled(&r)?;
        let amount = total(&r.terms.accepted()?)?;
        let weaver = r.weaver.clone();
        settle(&env, &id, r, weaver.clone(), amount, weaver, Stage::Repaid)
    }
    pub fn dealer_buy(env: Env, id: BytesN<32>) -> Result<(), Error> {
        let r = Self::get_receipt(env.clone(), id.clone())?;
        unsettled(&r)?;
        let t = r.terms.accepted()?;
        t.dealer.require_auth();
        if r.stage != Stage::Overdue {
            return Err(Error::TooEarly);
        }
        if !r.dealer_committed {
            return Err(Error::DealerNotCommitted);
        }
        settle(
            &env,
            &id,
            r,
            t.dealer.clone(),
            t.fallback_price,
            t.dealer,
            Stage::DealerPurchased,
        )
    }
    pub fn get_receipt(env: Env, id: BytesN<32>) -> Result<Receipt, Error> {
        let mut r: Receipt = env
            .storage()
            .persistent()
            .get(&Key::Receipt(id))
            .ok_or(Error::ReceiptMissing)?;
        if r.stage == Stage::Active
            && env.ledger().timestamp() >= r.deadline.ok_or(Error::WrongStage)?
        {
            r.stage = Stage::Overdue;
        }
        Ok(r)
    }
}
#[cfg(test)]
mod test;
