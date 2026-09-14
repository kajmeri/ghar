import type { DefaultCategoryKey } from './default-categories';

// Plaid's personal finance categories (PFC v1), mapped onto the default category tree by key.
// A detailed code maps to the most specific category that fits. A primary code is the fallback
// for detailed codes Plaid adds later. Codes that mean "other" map to the parent category.

const DETAILED: Readonly<Record<string, DefaultCategoryKey>> = {
  INCOME_DIVIDENDS: 'interest_dividends',
  INCOME_INTEREST_EARNED: 'interest_dividends',
  INCOME_RETIREMENT_PENSION: 'other_income',
  INCOME_TAX_REFUND: 'refunds',
  INCOME_UNEMPLOYMENT: 'other_income',
  INCOME_WAGES: 'paychecks',
  INCOME_OTHER_INCOME: 'other_income',

  TRANSFER_IN_CASH_ADVANCES_AND_LOANS: 'account_transfers',
  TRANSFER_IN_DEPOSIT: 'cash',
  TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS: 'savings_investments',
  TRANSFER_IN_SAVINGS: 'savings_investments',
  TRANSFER_IN_ACCOUNT_TRANSFER: 'account_transfers',
  TRANSFER_IN_OTHER_TRANSFER_IN: 'transfers',
  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: 'savings_investments',
  TRANSFER_OUT_SAVINGS: 'savings_investments',
  TRANSFER_OUT_WITHDRAWAL: 'cash',
  TRANSFER_OUT_ACCOUNT_TRANSFER: 'account_transfers',
  TRANSFER_OUT_OTHER_TRANSFER_OUT: 'transfers',

  LOAN_PAYMENTS_CAR_PAYMENT: 'car_payment',
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: 'credit_card_payments',
  LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT: 'loan_payments',
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'rent_mortgage',
  LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT: 'loan_payments',
  LOAN_PAYMENTS_OTHER_PAYMENT: 'loan_payments',

  BANK_FEES_ATM_FEES: 'bank_fees',
  BANK_FEES_FOREIGN_TRANSACTION_FEES: 'bank_fees',
  BANK_FEES_INSUFFICIENT_FUNDS: 'bank_fees',
  BANK_FEES_INTEREST_CHARGE: 'bank_fees',
  BANK_FEES_OVERDRAFT_FEES: 'bank_fees',
  BANK_FEES_OTHER_BANK_FEES: 'bank_fees',

  ENTERTAINMENT_CASINOS_AND_GAMBLING: 'events',
  ENTERTAINMENT_MUSIC_AND_AUDIO: 'subscriptions',
  ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS: 'events',
  ENTERTAINMENT_TV_AND_MOVIES: 'subscriptions',
  ENTERTAINMENT_VIDEO_GAMES: 'games',
  ENTERTAINMENT_OTHER_ENTERTAINMENT: 'entertainment',

  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: 'alcohol',
  FOOD_AND_DRINK_COFFEE: 'coffee',
  FOOD_AND_DRINK_FAST_FOOD: 'restaurants',
  FOOD_AND_DRINK_GROCERIES: 'groceries',
  FOOD_AND_DRINK_RESTAURANT: 'restaurants',
  FOOD_AND_DRINK_VENDING_MACHINES: 'food',
  FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK: 'food',

  GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS: 'hobbies',
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: 'clothing',
  GENERAL_MERCHANDISE_CONVENIENCE_STORES: 'everyday',
  GENERAL_MERCHANDISE_DEPARTMENT_STORES: 'everyday',
  GENERAL_MERCHANDISE_DISCOUNT_STORES: 'everyday',
  GENERAL_MERCHANDISE_ELECTRONICS: 'electronics',
  GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES: 'gifts',
  GENERAL_MERCHANDISE_OFFICE_SUPPLIES: 'everyday',
  GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: 'everyday',
  GENERAL_MERCHANDISE_PET_SUPPLIES: 'pets',
  GENERAL_MERCHANDISE_SPORTING_GOODS: 'hobbies',
  GENERAL_MERCHANDISE_SUPERSTORES: 'everyday',
  GENERAL_MERCHANDISE_TOBACCO_AND_VAPE: 'shopping',
  GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE: 'shopping',

  HOME_IMPROVEMENT_FURNITURE: 'furnishings',
  HOME_IMPROVEMENT_HARDWARE: 'home_maintenance',
  HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE: 'home_maintenance',
  HOME_IMPROVEMENT_SECURITY: 'home_maintenance',
  HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT: 'home_maintenance',

  MEDICAL_DENTAL_CARE: 'medical',
  MEDICAL_EYE_CARE: 'medical',
  MEDICAL_NURSING_CARE: 'medical',
  MEDICAL_PHARMACIES_AND_SUPPLEMENTS: 'pharmacy',
  MEDICAL_PRIMARY_CARE: 'medical',
  MEDICAL_VETERINARY_SERVICES: 'pets',
  MEDICAL_OTHER_MEDICAL: 'medical',

  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: 'fitness',
  PERSONAL_CARE_HAIR_AND_BEAUTY: 'personal_care',
  PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING: 'personal_care',
  PERSONAL_CARE_OTHER_PERSONAL_CARE: 'personal_care',

  GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING: 'services',
  GENERAL_SERVICES_AUTOMOTIVE: 'car_maintenance',
  GENERAL_SERVICES_CHILDCARE: 'childcare',
  GENERAL_SERVICES_CONSULTING_AND_LEGAL: 'services',
  GENERAL_SERVICES_EDUCATION: 'education',
  GENERAL_SERVICES_INSURANCE: 'insurance',
  GENERAL_SERVICES_POSTAGE_AND_SHIPPING: 'services',
  GENERAL_SERVICES_STORAGE: 'services',
  GENERAL_SERVICES_OTHER_GENERAL_SERVICES: 'services',

  GOVERNMENT_AND_NON_PROFIT_DONATIONS: 'giving',
  GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES: 'bills',
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: 'taxes',
  GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT: 'bills',

  TRANSPORTATION_BIKES_AND_SCOOTERS: 'transportation',
  TRANSPORTATION_GAS: 'fuel',
  TRANSPORTATION_PARKING: 'parking_tolls',
  TRANSPORTATION_PUBLIC_TRANSIT: 'public_transit',
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: 'rideshare',
  TRANSPORTATION_TOLLS: 'parking_tolls',
  TRANSPORTATION_OTHER_TRANSPORTATION: 'transportation',

  TRAVEL_FLIGHTS: 'flights',
  TRAVEL_LODGING: 'lodging',
  TRAVEL_RENTAL_CARS: 'rental_cars',
  TRAVEL_OTHER_TRAVEL: 'travel',

  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: 'utilities',
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: 'internet_phone',
  RENT_AND_UTILITIES_RENT: 'rent_mortgage',
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: 'utilities',
  RENT_AND_UTILITIES_TELEPHONE: 'internet_phone',
  RENT_AND_UTILITIES_WATER: 'utilities',
  RENT_AND_UTILITIES_OTHER_UTILITIES: 'utilities',
};

const PRIMARY: Readonly<Record<string, DefaultCategoryKey>> = {
  INCOME: 'income',
  TRANSFER_IN: 'transfers',
  TRANSFER_OUT: 'transfers',
  LOAN_PAYMENTS: 'loan_payments',
  BANK_FEES: 'bank_fees',
  ENTERTAINMENT: 'entertainment',
  FOOD_AND_DRINK: 'food',
  GENERAL_MERCHANDISE: 'shopping',
  HOME_IMPROVEMENT: 'home_maintenance',
  MEDICAL: 'health',
  PERSONAL_CARE: 'personal_care',
  GENERAL_SERVICES: 'services',
  GOVERNMENT_AND_NON_PROFIT: 'bills',
  TRANSPORTATION: 'transportation',
  TRAVEL: 'travel',
  RENT_AND_UTILITIES: 'home',
};

// Maps, so a code like "constructor" can never find something on Object's prototype.
const DETAILED_MAP = new Map(Object.entries(DETAILED));
const PRIMARY_MAP = new Map(Object.entries(PRIMARY));

/**
 * Plaid's confidence levels worth acting on. MEDIUM and below go to the next layer instead. A
 * transaction with no level at all (older data, the fake provider) is taken at its word.
 */
const TRUSTED_CONFIDENCE = new Set(['VERY_HIGH', 'HIGH']);

export interface PfcFields {
  plaidCategoryPrimary: string | null;
  plaidCategoryDetailed: string | null;
  plaidCategoryConfidence: string | null;
}

/** The default category Plaid's category points to, or null when it doesn't point anywhere firmly. */
export function pfcCategoryKey(transaction: PfcFields): DefaultCategoryKey | null {
  const confidence = transaction.plaidCategoryConfidence;
  if (confidence !== null && !TRUSTED_CONFIDENCE.has(confidence)) return null;
  const detailed = transaction.plaidCategoryDetailed;
  if (detailed !== null) {
    const key = DETAILED_MAP.get(detailed);
    if (key !== undefined) return key;
  }
  const primary = transaction.plaidCategoryPrimary;
  return primary === null ? null : (PRIMARY_MAP.get(primary) ?? null);
}

/** Every detailed code the map knows, for tests. */
export const MAPPED_PFC_DETAILED_CODES: readonly string[] = [...DETAILED_MAP.keys()];
