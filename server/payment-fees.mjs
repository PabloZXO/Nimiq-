export const PAYOUT_FEE_LUNA = 1000;
export const SHARED_FEE_RULES = 'nim-shared-fees-v2';
export const feeContribution = room => room.paymentRulesVersion === SHARED_FEE_RULES ? PAYOUT_FEE_LUNA : 0;
