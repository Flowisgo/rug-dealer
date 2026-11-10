#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env,
};

/// All amounts are in the smallest units of a seven-decimal test token.
pub const UNIT: i128 = 10_000_000;
pub const ADVANCE: i128 = 8 * UNIT;
pub const LENDER_DUE: i128 = 9 * UNIT;
pub const CUSTODY_FEE: i128 = UNIT;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanTerms {
    pub advance: i128,
    pub lender_due: i128,
    pub custody_fee: i128,
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
    Settled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Receipt {
    pub weaver: Address,
    pub lender: Option<Address>,
    pub buyer: Option<Address>,
    pub approved_price: Option<i128>,
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
    InvalidPrice = 5,
}

#[contract]
pub struct RugLoan;

fn save(env: &Env, id: &BytesN<32>, receipt: &Receipt) {
    env.storage()
        .persistent()
        .set(&Key::Receipt(id.clone()), receipt);
}

fn asset(env: &Env) -> Address {
    env.storage().instance().get(&Key::Token).unwrap()
}

#[contractimpl]
impl RugLoan {
    pub fn loan_terms() -> LoanTerms {
        LoanTerms {
            advance: ADVANCE,
            lender_due: LENDER_DUE,
            custody_fee: CUSTODY_FEE,
        }
    }

    pub fn __constructor(env: Env, warehouse: Address, token: Address) {
        assert_eq!(token::Client::new(&env, &token).decimals(), 7);
        env.storage().instance().set(&Key::Warehouse, &warehouse);
        env.storage().instance().set(&Key::Token, &token);
    }

    /// The configured warehouse attests it physically holds this rug.
    pub fn register_receipt(env: Env, id: BytesN<32>, weaver: Address) -> Result<(), Error> {
        let warehouse: Address = env.storage().instance().get(&Key::Warehouse).unwrap();
        warehouse.require_auth();
        if env.storage().persistent().has(&Key::Receipt(id.clone())) {
            return Err(Error::ReceiptExists);
        }
        save(
            &env,
            &id,
            &Receipt {
                weaver,
                lender: None,
                buyer: None,
                approved_price: None,
                stage: Stage::Held,
                ready_for_pickup: false,
            },
        );
        Ok(())
    }

    /// Weaver accepts the immutable demo terms: advance 8, repay 9, custody fee 1.
    /// The nominated lender is the only party allowed to fund these terms.
    pub fn accept_terms(env: Env, id: BytesN<32>, lender: Address) -> Result<(), Error> {
        let mut receipt = Self::get_receipt(env.clone(), id.clone())?;
        receipt.weaver.require_auth();
        if receipt.stage != Stage::Held {
            return Err(Error::WrongStage);
        }
        receipt.lender = Some(lender);
        receipt.stage = Stage::TermsAccepted;
        save(&env, &id, &receipt);
        Ok(())
    }

    pub fn fund_loan(env: Env, id: BytesN<32>) -> Result<(), Error> {
        let mut receipt = Self::get_receipt(env.clone(), id.clone())?;
        if receipt.stage != Stage::TermsAccepted {
            return Err(Error::WrongStage);
        }
        let lender = receipt.lender.clone().ok_or(Error::WrongStage)?;
        lender.require_auth();
        token::Client::new(&env, &asset(&env)).transfer(&lender, &receipt.weaver, &ADVANCE);
        receipt.stage = Stage::Active;
        save(&env, &id, &receipt);
        Ok(())
    }

    pub fn approve_sale(env: Env, id: BytesN<32>, price: i128) -> Result<(), Error> {
        let mut receipt = Self::get_receipt(env.clone(), id.clone())?;
        receipt.weaver.require_auth();
        if receipt.stage != Stage::Active {
            return Err(Error::WrongStage);
        }
        if price < LENDER_DUE + CUSTODY_FEE {
            return Err(Error::InvalidPrice);
        }
        receipt.approved_price = Some(price);
        save(&env, &id, &receipt);
        Ok(())
    }

    pub fn buy(env: Env, id: BytesN<32>, buyer: Address, payment: i128) -> Result<(), Error> {
        let mut receipt = Self::get_receipt(env.clone(), id.clone())?;
        buyer.require_auth();
        if receipt.stage != Stage::Active {
            return Err(Error::WrongStage);
        }
        let price = receipt.approved_price.ok_or(Error::PriceNotApproved)?;
        if payment != price {
            return Err(Error::InvalidPrice);
        }
        let warehouse: Address = env.storage().instance().get(&Key::Warehouse).unwrap();
        let lender = receipt.lender.clone().ok_or(Error::WrongStage)?;
        let contract = env.current_contract_address();
        let asset = asset(&env);
        let token = token::Client::new(&env, &asset);
        token.transfer(&buyer, &contract, &payment);
        token.transfer(&contract, &lender, &LENDER_DUE);
        token.transfer(&contract, &warehouse, &CUSTODY_FEE);
        token.transfer(
            &contract,
            &receipt.weaver,
            &(price - LENDER_DUE - CUSTODY_FEE),
        );
        // Any token failure aborts the invocation, rolling back every preceding transfer.
        receipt.buyer = Some(buyer);
        receipt.stage = Stage::Settled;
        receipt.ready_for_pickup = true;
        save(&env, &id, &receipt);
        Ok(())
    }

    pub fn get_receipt(env: Env, id: BytesN<32>) -> Result<Receipt, Error> {
        env.storage()
            .persistent()
            .get(&Key::Receipt(id))
            .ok_or(Error::ReceiptMissing)
    }
}

#[cfg(test)]
mod test;
