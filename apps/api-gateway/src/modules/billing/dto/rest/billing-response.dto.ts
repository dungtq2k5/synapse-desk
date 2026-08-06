export class SubscriptionResponseDto {
  /** NULL for a grandfathered tenant — free, internal, or pre-billing. */
  stripeCustomerId!: string | null;
  stripeSubscriptionId!: string | null;
  /** A label. Never an authorization input. */
  planName!: string;
  maxAgentSeats!: number;
  maxStorageBytes!: number;
  monthlyAiTokenBudget!: number;
  aiModelTier!: string;
  billingCycleStart!: Date | null;
  status!: string;
}

export class CheckoutSessionResponseDto {
  url!: string;
}

export class PortalSessionResponseDto {
  url!: string;
}

export class InvoiceResponseDto {
  id!: string;
  number!: string;
  amountDue!: number;
  currency!: string;
  status!: string;
  created!: Date | null;
  hostedInvoiceUrl!: string;
}
