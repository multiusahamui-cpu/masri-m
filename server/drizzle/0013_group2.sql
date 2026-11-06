CREATE SEQUENCE "public"."ap_doc_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"bank_name" text NOT NULL,
	"account_no" varchar(40) NOT NULL,
	"account_name" text NOT NULL,
	"currency" varchar(3) NOT NULL,
	"preset" varchar(16) DEFAULT 'generic' NOT NULL,
	"column_map" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"rows_total" integer NOT NULL,
	"rows_new" integer NOT NULL,
	"date_from" varchar(10),
	"date_to" varchar(10),
	"closing_balance" numeric(18, 2),
	"imported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"tx_date" varchar(10) NOT NULL,
	"description" text NOT NULL,
	"reference" varchar(80),
	"debit" numeric(18, 2) DEFAULT 0 NOT NULL,
	"credit" numeric(18, 2) DEFAULT 0 NOT NULL,
	"balance" numeric(18, 2),
	"seq" integer DEFAULT 0 NOT NULL,
	"hash" varchar(64) NOT NULL,
	"status" varchar(12) DEFAULT 'unmatched' NOT NULL,
	"match_type" varchar(24),
	"match_refs" jsonb,
	"note" text,
	"matched_by" uuid,
	"matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"title" jsonb NOT NULL,
	"subtitle" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"image_url" text,
	"theme" varchar(16) DEFAULT 'emerald' NOT NULL,
	"link_type" varchar(12) DEFAULT 'none' NOT NULL,
	"link_value" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"channel" varchar(8) NOT NULL,
	"segment" jsonb NOT NULL,
	"subject" text NOT NULL,
	"body" jsonb NOT NULL,
	"promo_id" uuid,
	"link" text,
	"status" varchar(12) DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipients" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "featured_products" (
	"country_code" varchar(2) NOT NULL,
	"product_id" uuid NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"label" varchar(16) DEFAULT 'featured' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	CONSTRAINT "featured_products_country_code_product_id_pk" PRIMARY KEY("country_code","product_id")
);
--> statement-breakpoint
CREATE TABLE "iqalah_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iqalah_no" varchar(24) NOT NULL,
	"application_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(16) DEFAULT 'requested' NOT NULL,
	"depreciation" numeric(18, 2) DEFAULT 0 NOT NULL,
	"paid_by_customer" numeric(18, 2) DEFAULT 0 NOT NULL,
	"refund_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"condition_note" text,
	"goods_condition" varchar(16),
	"refund_method" varchar(16),
	"bank_name" text,
	"account_no" varchar(40),
	"account_name" text,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"decision_note" text,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"refund_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "iqalah_requests_iqalah_no_unique" UNIQUE("iqalah_no")
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" varchar(8) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"max_discount" numeric(18, 2),
	"min_purchase" numeric(18, 2) DEFAULT 0 NOT NULL,
	"applies_to" varchar(8) DEFAULT 'both' NOT NULL,
	"category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quota" integer,
	"per_customer" integer DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_id" uuid NOT NULL,
	"phone" varchar(32) NOT NULL,
	"source_type" varchar(16) NOT NULL,
	"source_id" uuid NOT NULL,
	"source_no" varchar(24) NOT NULL,
	"discount" numeric(18, 2) NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"campaign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarantine_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"q_no" varchar(24) NOT NULL,
	"branch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" numeric(18, 2) NOT NULL,
	"source" varchar(16) NOT NULL,
	"source_ref" varchar(32),
	"source_id" uuid,
	"credit_to" varchar(8),
	"condition_note" text NOT NULL,
	"status" varchar(16) DEFAULT 'quarantined' NOT NULL,
	"supplier_id" uuid,
	"claim_no" varchar(24),
	"claim_amount" numeric(18, 2),
	"settled_amount" numeric(18, 2),
	"settled_method" varchar(16),
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quarantine_items_q_no_unique" UNIQUE("q_no")
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"shipment_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "shipment_items_shipment_id_product_id_pk" PRIMARY KEY("shipment_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_no" varchar(24) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_invoice_no" varchar(64) NOT NULL,
	"branch_id" uuid NOT NULL,
	"receipt_id" uuid,
	"invoice_date" varchar(10) NOT NULL,
	"due_date" varchar(10) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"receipt_value" numeric(18, 2) DEFAULT 0 NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax" numeric(18, 2) DEFAULT 0 NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"paid_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoices_invoice_no_unique" UNIQUE("invoice_no")
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_no" varchar(24) NOT NULL,
	"invoice_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" varchar(16) NOT NULL,
	"bank_ref" varchar(64),
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_payment_no_unique" UNIQUE("payment_no")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(24) NOT NULL,
	"name" text NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"tax_id" varchar(32),
	"phone" varchar(32),
	"email" varchar(255),
	"address" text DEFAULT '' NOT NULL,
	"bank_name" text,
	"account_no" varchar(40),
	"account_name" text,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "credit_applications" ADD COLUMN "list_price" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "credit_applications" ADD COLUMN "promo_code" varchar(32);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "marketing_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "marketing_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "last_promo_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "allocation" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount" numeric(18, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "promo_code" varchar(32);--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_imports" ADD CONSTRAINT "bank_imports_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_imports" ADD CONSTRAINT "bank_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_import_id_bank_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."bank_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_matched_by_users_id_fk" FOREIGN KEY ("matched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "featured_products" ADD CONSTRAINT "featured_products_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "featured_products" ADD CONSTRAINT "featured_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqalah_requests" ADD CONSTRAINT "iqalah_requests_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."credit_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqalah_requests" ADD CONSTRAINT "iqalah_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqalah_requests" ADD CONSTRAINT "iqalah_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqalah_requests" ADD CONSTRAINT "iqalah_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqalah_requests" ADD CONSTRAINT "iqalah_requests_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqalah_requests" ADD CONSTRAINT "iqalah_requests_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_items" ADD CONSTRAINT "quarantine_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_items" ADD CONSTRAINT "quarantine_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_items" ADD CONSTRAINT "quarantine_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_items" ADD CONSTRAINT "quarantine_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_items" ADD CONSTRAINT "quarantine_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_acc_no_uq" ON "bank_accounts" USING btree ("bank_name","account_no");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_line_hash_uq" ON "bank_lines" USING btree ("account_id","hash");--> statement-breakpoint
CREATE INDEX "bank_line_status_idx" ON "bank_lines" USING btree ("account_id","status","tx_date");--> statement-breakpoint
CREATE INDEX "banners_country_idx" ON "banners" USING btree ("country_code","is_active");--> statement-breakpoint
CREATE INDEX "iqalah_app_idx" ON "iqalah_requests" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "iqalah_branch_idx" ON "iqalah_requests" USING btree ("branch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_code_country_uq" ON "promo_codes" USING btree ("code","country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_red_source_uq" ON "promo_redemptions" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "promo_red_promo_idx" ON "promo_redemptions" USING btree ("promo_id","status");--> statement-breakpoint
CREATE INDEX "promo_red_phone_idx" ON "promo_redemptions" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "quarantine_branch_idx" ON "quarantine_items" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "ap_inv_supplier_idx" ON "supplier_invoices" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ap_inv_supplier_no_uq" ON "supplier_invoices" USING btree ("supplier_id","supplier_invoice_no");--> statement-breakpoint
CREATE INDEX "ap_inv_due_idx" ON "supplier_invoices" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "ap_pay_invoice_idx" ON "supplier_payments" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;