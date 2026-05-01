export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const KEY_LENGTH = 32;
export const ECIES_PUBKEY_LENGTH = 65;
export const ECIES_HKDF_INFO = new TextEncoder().encode('BlindMarket-ECIES-v1');
export const AES_MIN_BLOB = IV_LENGTH + TAG_LENGTH;
export const ECIES_MIN_BLOB = ECIES_PUBKEY_LENGTH + AES_MIN_BLOB;
