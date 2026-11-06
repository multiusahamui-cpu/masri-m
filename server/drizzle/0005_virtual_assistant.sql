ALTER TYPE "public"."ticket_channel" ADD VALUE 'chat';--> statement-breakpoint
CREATE TABLE "assistant_usage" (
	"day" varchar(10) NOT NULL,
	"model" varchar(64) NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"tickets_created" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "assistant_usage_day_model_pk" PRIMARY KEY("day","model")
);
--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ALTER COLUMN "created_by" DROP NOT NULL;