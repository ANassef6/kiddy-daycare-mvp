export type Branding = {
  name: string;
  logoUrl: string | null;
  brandImageUrl: string | null;
  primaryColor: string;
  accentColor: string;
  font: string;
};

export type Account = {
  id: string;
  email: string;
  role: string;
  fullName: string | null;
};

export type SessionPayload = {
  account: Account;
  token: string;
};

export type LoginBody = {
  account: Account;
  token: string;
};

export type ChildInfo = {
  id: string;
  first_name: string;
  last_name: string;
  room_name: string | null;
};

export type CheckInStatus = {
  checkedIn: string | null;
  checkedOut: string | null;
  lastEvent: { type: string; at: string } | null;
};

export type Report = {
  id: string;
  childId: string;
  reportDate: string;
  summary: string;
  observation: string;
  mood: string;
  meal: Record<string, string>;
  sleep: Record<string, unknown>;
  diaper: string;
  sick: boolean;
  note: string;
  createdAt: string;
};

export type ChildSummary = {
  child: ChildInfo;
  status: CheckInStatus;
  todayReport: Report | null;
};

export type BootstrapPayload = {
  account: Account;
  branding: Branding;
  children: ChildSummary[];
};

export type Contact = {
  id: string;
  fullName: string;
  relationship: string;
  phone: string | null;
  email: string | null;
  isPickup: boolean;
  isEmergency: boolean;
};

export type NewsfeedPost = {
  id: string;
  authorName: string | null;
  body: string;
  mediaUrl: string | null;
  createdAt: string;
};

export type Incident = {
  id: string;
  type: string;
  description: string;
  acknowledged: boolean;
  createdAt: string;
};

export type ChildDetailPayload = ChildSummary & {
  contacts: Contact[];
  newsfeed: NewsfeedPost[];
  incidents: Incident[];
};

export type Plan = {
  planName: string;
  amountCents: number;
  billingPeriod: string | null;
  currency: string | null;
};

export type Invoice = {
  id: string;
  number: string;
  description: string | null;
  amountCents: number;
  currency: string | null;
  dueDate: string | null;
  status: string;
  paidCents: number;
};

export type PaymentRecord = {
  id: string;
  invoiceNumber: string;
  invoiceDescription: string | null;
  method: string | null;
  reference: string | null;
  amountCents: number;
  paidAt: string;
};

export type Method = {
  id: string;
  label: string;
  provider: string | null;
  last4: string | null;
  isDefault: boolean;
};

export type BillingChild = {
  child: { id: string; firstName: string; lastName: string; roomName: string | null };
  plan: Plan | null;
  invoices: Invoice[];
  payments: PaymentRecord[];
};

export type BillingPayload = {
  children: BillingChild[];
  paymentMethods: Method[];
};