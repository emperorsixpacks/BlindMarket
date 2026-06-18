/**
 * Type declarations for @mysten/sui (optional peer dependency).
 * These allow compilation without @mysten/sui installed.
 * The real modules are dynamically imported at runtime.
 */
declare module '@mysten/sui/client' {
  export function getFullnodeUrl(network: string): string;
  export class SuiClient {
    constructor(opts: { url: string });
  }
}

declare module '@mysten/sui/transactions' {
  export class Transaction {
    setSender(sender: string): void;
    toJSON(): Promise<Record<string, unknown>>;
  }
}
