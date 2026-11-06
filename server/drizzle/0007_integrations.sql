CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"filename" text NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel" varchar(16) NOT NULL,
	"recipient" text NOT NULL,
	"template" varchar(48) NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"ref_type" varchar(24),
	"ref_id" varchar(64),
	"dedupe_key" varchar(160),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"provider" varchar(24),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "postal_code" varchar(10);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "postal_code" varchar(10);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "bank" varchar(16);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "qr_string" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "qr_url" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "postal_code" varchar(10);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "external_ref" varchar(64);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "courier_status" varchar(32);--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "notification_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_ref_idx" ON "notification_outbox" USING btree ("ref_type","ref_id");