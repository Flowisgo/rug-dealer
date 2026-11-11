# Rug financing

Weavers borrow against finished rugs held by a trusted warehouse, then settle the loan through a sale.

## Language

**Weaver**:
The owner of a finished rug who borrows against it and approves its sale.
_Avoid_: Seller, borrower (when naming this party)

**Warehouse**:
The trusted partner that confirms physical custody of a rug and holds it until settlement permits pickup.

**Receipt**:
The warehouse’s record identifying a particular rug and its weaver while the rug is in custody.
_Avoid_: Rug token, ownership token

**Lender**:
The investor who advances funds to the weaver in exchange for an agreed repayment.

**Loan terms**:
The advance, lender repayment, custody fee, fallback price, duration, and nominated lender and dealer accepted by the weaver before funding.

**Active loan**:
A funded loan that has not been settled; its receipt cannot secure another loan.

**Approved sale price**:
The amount the weaver agrees a buyer must pay for the rug.

**Settlement**:
The completed payment that repays the lender, pays custody, and determines who may collect the rug.

**Ready for pickup**:
The rug’s release status after settlement succeeds, distinct from the physical handoff.
_Avoid_: Delivered, shipped

**Dealer**:
The nominated rug purchaser who promises to buy an unpaid overdue rug at an agreed fallback price.
_Avoid_: Guarantor, insurer

**Fallback commitment**:
The dealer’s authorized promise to pay a specified price for the rug after its repayment deadline; the promise itself is not a payment.

**Repayment deadline**:
The end of the agreed loan duration measured from successful funding.

**Overdue loan**:
An unsettled loan whose repayment deadline has arrived. Its rug remains locked until payment settles it.
_Avoid_: Liquidated, settled by default

**Direct repayment**:
Payment by the weaver of the lender repayment and custody fee to reclaim pickup rights.

**Pickup recipient**:
The wallet cleared to collect the rug after settlement: its buyer, its dealer purchaser, or its repaying weaver.
