CREATE TYPE "public"."order_status" AS ENUM('awaiting_payment', 'paid', 'fulfilling', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('pending', 'scheduled', 'ready_pickup', 'in_transit', 'delivered', 'failed', 'cancelled');--> statement-breakpoint
CREATE SEQUENCE "public"."order_doc_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."payment_doc_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "order_items" (
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	CONSTRAINT "order_items_order_id_product_id_pk" PRIMARY KEY("order_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" varchar(24) NOT NULL,
	"status" "order_status" DEFAULT 'awaiting_payment' NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"fulfill_branch_id" uuid NOT NULL,
	"currency" varchar(3) DEFAULT 'IDR' NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax" numeric(18, 2) DEFAULT 0 NOT NULL,
	"shipping_fee" numeric(18, 2) DEFAULT 0 NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"delivery_mode" varchar(16) NOT NULL,
	"courier_code" varchar(24),
	"courier_service" varchar(40),
	"recipient_name" text NOT NULL,
	"recipient_phone" varchar(32) NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"payment_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	CONSTRAINT "payment_allocations_payment_id_installment_id_pk" PRIMARY KEY("payment_id","installment_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_no" varchar(24) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"ref_id" uuid NOT NULL,
	"ref_no" varchar(24) NOT NULL,
	"branch_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"tazir_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"method" varchar(16) NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"channel" varchar(16) NOT NULL,
	"va_number" varchar(32),
	"gateway_ref" varchar(64),
	"proof_ref" varchar(64),
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"received_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_payment_no_unique" UNIQUE("payment_no")
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shipment_id" uuid NOT NULL,
	"status" varchar(24) NOT NULL,
	"message" text,
	"actor_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_no" varchar(24) NOT NULL,
	"source_type" varchar(16) NOT NULL,
	"source_id" uuid NOT NULL,
	"source_no" varchar(24) NOT NULL,
	"branch_id" uuid NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"mode" varchar(16) NOT NULL,
	"status" "shipment_status" DEFAULT 'pending' NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" varchar(32) NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"items_summary" text NOT NULL,
	"weight_kg" numeric(10, 2) DEFAULT 0 NOT NULL,
	"is_bulky" boolean DEFAULT false NOT NULL,
	"needs_installation" boolean DEFAULT false NOT NULL,
	"shipping_fee" numeric(18, 2) DEFAULT 0 NOT NULL,
	"driver_id" uuid,
	"vehicle_ref" varchar(40),
	"scheduled_date" varchar(10),
	"scheduled_slot" varchar(16),
	"courier_code" varchar(24),
	"courier_service" varchar(40),
	"tracking_no" varchar(64),
	"pickup_code" varchar(8),
	"pickup_expires_at" timestamp with time zone,
	"pod_name" text,
	"pod_note" text,
	"pod_photo_url" text,
	"delivered_at" timestamp with time zone,
	"delivered_by" uuid,
	"fail_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_shipment_no_unique" UNIQUE("shipment_no")
);
--> statement-breakpoint
ALTER TABLE "credit_applications" ADD COLUMN "shipping_fee" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfill_branch_id_branches_id_fk" FOREIGN KEY ("fulfill_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_branch_idx" ON "orders" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "payments_ref_idx" ON "payments" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_branch_idx" ON "payments" USING btree ("branch_id","paid_at");--> statement-breakpoint
CREATE INDEX "shipment_events_idx" ON "shipment_events" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipments_from_idx" ON "shipments" USING btree ("from_branch_id");--> statement-breakpoint
CREATE INDEX "shipments_driver_idx" ON "shipments" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "shipments_source_idx" ON "shipments" USING btree ("source_type","source_id");