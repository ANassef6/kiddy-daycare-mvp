import { NextRequest, NextResponse } from "next/server";
import { requireMobileSession, errorPayload } from "@/lib/mobile-api";
import { familiesForAccount, getChildPlan, invoicesForChild, paymentsForChild, accountPaymentMethods } from "@/lib/store";

export const dynamic = "force-dynamic";

// Billing basics for the parent, read-only (mirrors M3/KID-5): each linked
// child's fee plan, invoices (with what's been paid) and recorded payments,
// plus the account's saved payment method(s).
export async function GET(req: NextRequest) {
  const session = await requireMobileSession(req);
  if (session instanceof NextResponse) return session;

  const families = await familiesForAccount(session.accountId);
  const children = [];
  for (const child of families) {
    const plan = await getChildPlan(child.id as string);
    const invoices = await invoicesForChild(child.id as string);
    const payments = await paymentsForChild(child.id as string);
    children.push({
      child: {
        id: child.id,
        firstName: child.first_name,
        lastName: child.last_name,
        roomName: child.room_name ?? null,
      },
      plan: plan
        ? {
            planName: plan.plan_name,
            amountCents: plan.amount_cents,
            billingPeriod: plan.billing_period,
            currency: plan.currency,
          }
        : null,
      invoices: invoices.map((i: any) => ({
        id: i.id,
        number: i.number,
        description: i.description,
        amountCents: i.amount_cents,
        currency: i.currency,
        dueDate: i.due_date,
        status: i.status,
        paidCents: i.paid_cents ?? 0,
      })),
      payments: payments.map((p: any) => ({
        id: p.id,
        invoiceNumber: p.number,
        invoiceDescription: p.description,
        method: p.method,
        reference: p.reference,
        amountCents: p.amount_cents,
        paidAt: p.paid_at,
      })),
    });
  }

  const methods = await accountPaymentMethods(session.accountId);

  return NextResponse.json({
    children,
    paymentMethods: methods.map((m: any) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      last4: m.last4,
      isDefault: !!m.is_default,
    })),
  });
}