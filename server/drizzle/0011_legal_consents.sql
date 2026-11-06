CREATE TABLE "consents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subject_type" varchar(24) NOT NULL,
	"subject_id" text NOT NULL,
	"phone" varchar(32),
	"document" varchar(24) NOT NULL,
	"version" varchar(16) NOT NULL,
	"lang" varchar(5),
	"country_code" varchar(2),
	"ip" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "consents_subject_idx" ON "consents" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "consents_phone_idx" ON "consents" USING btree ("phone");