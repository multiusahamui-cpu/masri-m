CREATE SEQUENCE "public"."journal_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "accounting_periods" (
	"period" varchar(7) PRIMARY KEY NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "charity_disbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"disb_no" varchar(24) NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" varchar(10) NOT NULL,
	"recipient" text NOT NULL,
	"purpose" varchar(24) NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" varchar(16) NOT NULL,
	"ref" varchar(64),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charity_disbursements_disb_no_unique" UNIQUE("disb_no")
);
--> statement-breakpoint
CREATE TABLE "coa_accounts" (
	"code" varchar(8) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" varchar(12) NOT NULL,
	"normal" varchar(6) NOT NULL,
	"group_name" varchar(48) DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_no" varchar(24) NOT NULL,
	"date" varchar(10) NOT NULL,
	"source_type" varchar(16) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"event" varchar(16) DEFAULT 'main' NOT NULL,
	"source_no" varchar(32),
	"memo" text NOT NULL,
	"status" varchar(12) DEFAULT 'posted' NOT NULL,
	"reversal_of" uuid,
	"meta" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_entry_no_unique" UNIQUE("entry_no")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_code" varchar(8) NOT NULL,
	"branch_id" uuid NOT NULL,
	"debit" numeric(18, 2) DEFAULT 0 NOT NULL,
	"credit" numeric(18, 2) DEFAULT 0 NOT NULL,
	"memo" text,
	"sub_type" varchar(16),
	"sub_id" uuid
);
--> statement-breakpoint
CREATE TABLE "posting_errors" (
	"source_type" varchar(16) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"message" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posting_errors_source_type_source_id_pk" PRIMARY KEY("source_type","source_id")
);
--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charity_disbursements" ADD CONSTRAINT "charity_disbursements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charity_disbursements" ADD CONSTRAINT "charity_disbursements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_code_coa_accounts_code_fk" FOREIGN KEY ("account_code") REFERENCES "public"."coa_accounts"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charity_branch_idx" ON "charity_disbursements" USING btree ("branch_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_source_uq" ON "journal_entries" USING btree ("source_type","source_id","event");--> statement-breakpoint
CREATE INDEX "journal_date_idx" ON "journal_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "jl_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "jl_account_idx" ON "journal_lines" USING btree ("account_code","branch_id");--> statement-breakpoint
CREATE INDEX "jl_sub_idx" ON "journal_lines" USING btree ("sub_type","sub_id");