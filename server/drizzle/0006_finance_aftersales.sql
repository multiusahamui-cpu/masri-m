CREATE SEQUENCE "public"."finance_doc_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "branch_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_no" varchar(24) NOT NULL,
	"branch_id" uuid NOT NULL,
	"category" varchar(24) NOT NULL,
	"description" text NOT NULL,
	"vendor" text,
	"amount" numeric(18, 2) NOT NULL,
	"expense_date" varchar(10) NOT NULL,
	"method" varchar(16) NOT NULL,
	"receipt_ref" varchar(64),
	"status" varchar(16) DEFAULT 'submitted' NOT NULL,
	"requires_hq" boolean DEFAULT false NOT NULL,
	"submitted_by" uuid NOT NULL,
	"mc_by" uuid,
	"mc_at" timestamp with time zone,
	"hq_by" uuid,
	"hq_at" timestamp with time zone,
	"decision_note" text,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"paid_ref" varchar(64),
	"shift_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_expenses_expense_no_unique" UNIQUE("expense_no")
);
--> statement-breakpoint
CREATE TABLE "cashier_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_no" varchar(24) NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opening_cash" numeric(18, 2) DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"cash_in" numeric(18, 2),
	"cash_out" numeric(18, 2),
	"expected_cash" numeric(18, 2),
	"counted_cash" numeric(18, 2),
	"variance" numeric(18, 2),
	"deposit_amount" numeric(18, 2),
	"deposit_ref" varchar(64),
	"closing_note" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verify_note" text,
	CONSTRAINT "cashier_shifts_shift_no_unique" UNIQUE("shift_no")
);
--> statement-breakpoint
CREATE TABLE "product_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_no" varchar(24) NOT NULL,
	"source_type" varchar(16) NOT NULL,
	"source_id" uuid NOT NULL,
	"source_no" varchar(24) NOT NULL,
	"branch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" varchar(32),
	"reason" varchar(24) NOT NULL,
	"description" text NOT NULL,
	"resolution" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'requested' NOT NULL,
	"condition" varchar(16),
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"decision_note" text,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"replacement_shipment_id" uuid,
	"refund_id" uuid,
	"completed_at" timestamp with time zone,
	"completion_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_returns_return_no_unique" UNIQUE("return_no")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_no" varchar(24) NOT NULL,
	"source_type" varchar(16) NOT NULL,
	"source_id" uuid NOT NULL,
	"source_no" varchar(24) NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" varchar(32),
	"amount" numeric(18, 2) NOT NULL,
	"reason" text NOT NULL,
	"method" varchar(16) NOT NULL,
	"bank_name" text,
	"account_no" varchar(40),
	"account_name" text,
	"status" varchar(16) DEFAULT 'requested' NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"decision_note" text,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"paid_ref" varchar(64),
	"shift_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_refund_no_unique" UNIQUE("refund_no")
);
--> statement-breakpoint
CREATE TABLE "tazir_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"assessed_on" varchar(10) NOT NULL,
	"status" varchar(16) DEFAULT 'unpaid' NOT NULL,
	"payment_id" uuid,
	"waived_by" uuid,
	"waive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tazir_charges_installment_id_unique" UNIQUE("installment_id")
);
--> statement-breakpoint
ALTER TABLE "credit_applications" ADD COLUMN "settled_early_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD COLUMN "ibra_amount" numeric(18, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "ibra_amount" numeric(18, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "branch_expenses" ADD CONSTRAINT "branch_expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_expenses" ADD CONSTRAINT "branch_expenses_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_expenses" ADD CONSTRAINT "branch_expenses_mc_by_users_id_fk" FOREIGN KEY ("mc_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_expenses" ADD CONSTRAINT "branch_expenses_hq_by_users_id_fk" FOREIGN KEY ("hq_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_expenses" ADD CONSTRAINT "branch_expenses_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_expenses" ADD CONSTRAINT "branch_expenses_shift_id_cashier_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."cashier_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_returns" ADD CONSTRAINT "product_returns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_returns" ADD CONSTRAINT "product_returns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_returns" ADD CONSTRAINT "product_returns_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_returns" ADD CONSTRAINT "product_returns_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_returns" ADD CONSTRAINT "product_returns_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_returns" ADD CONSTRAINT "product_returns_replacement_shipment_id_shipments_id_fk" FOREIGN KEY ("replacement_shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_returns" ADD CONSTRAINT "product_returns_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_shift_id_cashier_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."cashier_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tazir_charges" ADD CONSTRAINT "tazir_charges_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tazir_charges" ADD CONSTRAINT "tazir_charges_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tazir_charges" ADD CONSTRAINT "tazir_charges_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tazir_charges" ADD CONSTRAINT "tazir_charges_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tazir_charges" ADD CONSTRAINT "tazir_charges_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_branch_idx" ON "branch_expenses" USING btree ("branch_id","expense_date");--> statement-breakpoint
CREATE INDEX "expenses_status_idx" ON "branch_expenses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shifts_branch_idx" ON "cashier_shifts" USING btree ("branch_id","opened_at");--> statement-breakpoint
CREATE INDEX "shifts_user_idx" ON "cashier_shifts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "returns_branch_idx" ON "product_returns" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "returns_source_idx" ON "product_returns" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "refunds_branch_idx" ON "refunds" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "refunds_source_idx" ON "refunds" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "tazir_app_idx" ON "tazir_charges" USING btree ("application_id","status");