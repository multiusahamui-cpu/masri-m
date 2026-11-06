DROP INDEX "installments_app_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open_uq" ON "cashier_shifts" USING btree ("user_id") WHERE "cashier_shifts"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "installments_app_seq_uq" ON "installments" USING btree ("application_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "iqalah_one_open_uq" ON "iqalah_requests" USING btree ("application_id") WHERE "iqalah_requests"."status" in ('requested','approved');--> statement-breakpoint
CREATE UNIQUE INDEX "ap_inv_receipt_open_uq" ON "supplier_invoices" USING btree ("receipt_id") WHERE "supplier_invoices"."status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "branch_expenses" ADD CONSTRAINT "expenses_amount_ck" CHECK ("branch_expenses"."amount" > 0);--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_amount_ck" CHECK ("installments"."amount" > 0 and "installments"."paid_amount" >= 0 and "installments"."paid_amount" <= "installments"."amount" + 0.01);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_amount_ck" CHECK ("orders"."total" >= 0 and "orders"."discount" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount" >= 0 and "payments"."tazir_amount" >= 0 and "payments"."ibra_amount" >= 0);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_ck" CHECK ("refunds"."amount" > 0);--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_nonneg_ck" CHECK ("stock_levels"."on_hand" >= 0 and "stock_levels"."reserved" >= 0 and "stock_levels"."reserved" <= "stock_levels"."on_hand");--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "ap_inv_amount_ck" CHECK ("supplier_invoices"."total" >= 0 and "supplier_invoices"."paid_amount" >= 0 and "supplier_invoices"."paid_amount" <= "supplier_invoices"."total" + 0.01);--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "ap_pay_amount_ck" CHECK ("supplier_payments"."amount" > 0);