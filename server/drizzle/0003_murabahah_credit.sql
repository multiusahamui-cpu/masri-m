CREATE TYPE "public"."credit_status" AS ENUM('submitted', 'assigned', 'branch_review', 'hq_review', 'approved', 'contracted', 'active', 'paid_off', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."installment_status" AS ENUM('scheduled', 'paid', 'partial');--> statement-breakpoint
CREATE SEQUENCE "public"."credit_doc_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "credit_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_no" varchar(24) NOT NULL,
	"status" "credit_status" DEFAULT 'submitted' NOT NULL,
	"channel" varchar(16) DEFAULT 'web' NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"currency" varchar(3) DEFAULT 'IDR' NOT NULL,
	"cash_price" numeric(18, 2) NOT NULL,
	"requested_tenor" integer NOT NULL,
	"requested_dp_pct" numeric(5, 2) NOT NULL,
	"purpose" text,
	"ao_id" uuid,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone,
	"kyc_checklist" jsonb,
	"kyc_completed_at" timestamp with time zone,
	"ao_recommendation" varchar(8),
	"ao_suggested_tenor" integer,
	"ao_suggested_dp_pct" numeric(5, 2),
	"ao_notes" text,
	"ao_recommended_at" timestamp with time zone,
	"mc_id" uuid,
	"mc_notes" text,
	"mc_reviewed_at" timestamp with time zone,
	"requires_committee" boolean DEFAULT false NOT NULL,
	"decided_by" uuid,
	"decision_notes" text,
	"decided_at" timestamp with time zone,
	"tenor" integer,
	"dp_pct" numeric(5, 2),
	"down_payment" numeric(18, 2),
	"financed" numeric(18, 2),
	"margin_pct" numeric(6, 2),
	"margin_amount" numeric(18, 2),
	"sale_price" numeric(18, 2),
	"monthly" numeric(18, 2),
	"fulfill_branch_id" uuid,
	"contract_no" varchar(24),
	"contract_signed_at" timestamp with time zone,
	"contract_signed_by" uuid,
	"dp_paid_amount" numeric(18, 2),
	"dp_paid_at" timestamp with time zone,
	"dp_method" varchar(16),
	"dp_ref" varchar(64),
	"handover_at" timestamp with time zone,
	"handover_by" uuid,
	"handover_method" varchar(16),
	"handover_note" text,
	"closed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_applications_app_no_unique" UNIQUE("app_no"),
	CONSTRAINT "credit_applications_contract_no_unique" UNIQUE("contract_no")
);
--> statement-breakpoint
CREATE TABLE "credit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"actor_role" varchar(32),
	"message" text,
	"from_status" "credit_status",
	"to_status" "credit_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_hq_votes" (
	"application_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"decision" varchar(8) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_hq_votes_application_id_user_id_pk" PRIMARY KEY("application_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "credit_surveys" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"surveyor_id" uuid NOT NULL,
	"visited_at" timestamp with time zone NOT NULL,
	"address_verified" boolean NOT NULL,
	"residence_status" varchar(16) NOT NULL,
	"length_of_stay_years" integer DEFAULT 0 NOT NULL,
	"income_verified" boolean NOT NULL,
	"verified_income" numeric(18, 2) NOT NULL,
	"other_obligations" numeric(18, 2) DEFAULT 0 NOT NULL,
	"character_score" integer NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"due_date" varchar(10) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"paid_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"status" "installment_status" DEFAULT 'scheduled' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "nik" varchar(32);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "birth_date" varchar(10);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "marital_status" varchar(16);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "dependents" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "occupation" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "employer" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "monthly_income" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "kyc_status" varchar(16) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "kyc_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "kyc_verified_by" uuid;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_ao_id_users_id_fk" FOREIGN KEY ("ao_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_mc_id_users_id_fk" FOREIGN KEY ("mc_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_fulfill_branch_id_branches_id_fk" FOREIGN KEY ("fulfill_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_contract_signed_by_users_id_fk" FOREIGN KEY ("contract_signed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_handover_by_users_id_fk" FOREIGN KEY ("handover_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_events" ADD CONSTRAINT "credit_events_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_events" ADD CONSTRAINT "credit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_hq_votes" ADD CONSTRAINT "credit_hq_votes_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_hq_votes" ADD CONSTRAINT "credit_hq_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_surveys" ADD CONSTRAINT "credit_surveys_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_surveys" ADD CONSTRAINT "credit_surveys_surveyor_id_users_id_fk" FOREIGN KEY ("surveyor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_status_idx" ON "credit_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_branch_idx" ON "credit_applications" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "credit_ao_idx" ON "credit_applications" USING btree ("ao_id");--> statement-breakpoint
CREATE INDEX "credit_customer_idx" ON "credit_applications" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "credit_events_app_idx" ON "credit_events" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "installments_app_idx" ON "installments" USING btree ("application_id","seq");--> statement-breakpoint
CREATE INDEX "installments_due_idx" ON "installments" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "customers_nik_idx" ON "customers" USING btree ("nik");