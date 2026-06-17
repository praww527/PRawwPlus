/**
 * DID Provider interface — every provider (BizVoIP, Telnyx, etc.) must implement this.
 *
 * The numbers route delegates all external DID operations through this interface
 * so provider-specific logic never leaks into the core route layer.
 */

export interface AvailableDid {
  phoneNumber: string;
  numberType: "local" | "mobile" | "tollfree" | "national";
  region: string | null;
  monthlyRateZar: number | null;
  upfrontCostZar: number | null;
  isPremium: boolean;
  providerRef: string;
}

export interface ProvisionedDid {
  phoneNumber: string;
  providerRef: string;
  sipTrunk: string;
}

export interface ReleaseResult {
  released: boolean;
  providerRef: string;
}

export interface DidProvider {
  /** Human-readable name used in logs and admin UI */
  readonly name: string;

  /** Search available DIDs from the provider */
  searchAvailable(params: {
    countryCode: string;
    numberType?: string;
    contains?: string;
    limit?: number;
  }): Promise<AvailableDid[]>;

  /** Provision (purchase/lease) a DID from the provider and point it at our SIP trunk */
  provision(params: {
    phoneNumber: string;
    providerRef: string;
    sipTrunkHost: string;
    sipTrunkPort?: number;
  }): Promise<ProvisionedDid>;

  /** Re-point an existing DID to a new SIP trunk host (for trunk migration) */
  updateTrunk(providerRef: string, sipTrunkHost: string, sipTrunkPort?: number): Promise<void>;

  /** Release a DID back to the provider (on number removal) */
  release(params: {
    phoneNumber: string;
    providerRef: string;
  }): Promise<ReleaseResult>;

  /** Health check — returns true if the provider API is reachable and credentials valid */
  ping(): Promise<boolean>;
}
