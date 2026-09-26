CREATE TYPE "public"."adjustment_reason" AS ENUM('Damaged', 'Lost', 'Found', 'Miscount', 'Other');--> statement-breakpoint
CREATE TYPE "public"."operation_kind" AS ENUM('Receipt', 'Delivery', 'Internal Transfer', 'Adjustment');--> statement-breakpoint
CREATE TYPE "public"."location_kind" AS ENUM('Internal', 'Vendor', 'Customer', 'Inventory Loss');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('Inventory Manager', 'Warehouse Staff');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('Draft', 'Waiting', 'Ready', 'Done', 'Canceled');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"kind" "location_kind" DEFAULT 'Internal' NOT NULL,
	"parent_id" uuid,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"demand_qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"received_qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"picked" boolean DEFAULT false NOT NULL,
	"reason" "adjustment_reason",
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"kind" "operation_kind" NOT NULL,
	"status" "status" DEFAULT 'Draft' NOT NULL,
	"partner" text,
	"scheduled_date" date,
	"source_location_id" uuid,
	"dest_location_id" uuid,
	"source_document" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_reset_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"category_id" uuid,
	"unit" text DEFAULT 'units' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reordering_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"min_qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"max_qty" numeric(14, 3) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid,
	"reference" text NOT NULL,
	"product_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"kind" "operation_kind" NOT NULL,
	"status" "status" DEFAULT 'Done' NOT NULL,
	"done_by_id" uuid,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_quants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" numeric(14, 3) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'Warehouse Staff' NOT NULL,
	"low_stock_alerts" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_locations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_lines" ADD CONSTRAINT "operation_lines_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_lines" ADD CONSTRAINT "operation_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_source_location_id_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_dest_location_id_locations_id_fk" FOREIGN KEY ("dest_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_otps" ADD CONSTRAINT "password_reset_otps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reordering_rules" ADD CONSTRAINT "reordering_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reordering_rules" ADD CONSTRAINT "reordering_rules_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_done_by_id_users_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_quants" ADD CONSTRAINT "stock_quants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_quants" ADD CONSTRAINT "stock_quants_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_key" ON "categories" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_full_name_key" ON "locations" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "locations_warehouse_idx" ON "locations" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "operation_lines_operation_idx" ON "operation_lines" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_reference_key" ON "operations" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "operations_kind_status_idx" ON "operations" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "operations_scheduled_date_idx" ON "operations" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "password_reset_otps_user_idx" ON "password_reset_otps" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_key" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_name_idx" ON "products" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "reordering_rules_product_warehouse_key" ON "reordering_rules" USING btree ("product_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_moves_product_idx" ON "stock_moves" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stock_moves_done_at_idx" ON "stock_moves" USING btree ("done_at");--> statement-breakpoint
CREATE INDEX "stock_moves_reference_idx" ON "stock_moves" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "stock_moves_kind_status_idx" ON "stock_moves" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_quants_product_location_key" ON "stock_quants" USING btree ("product_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_quants_product_idx" ON "stock_quants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stock_quants_location_idx" ON "stock_quants" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses" USING btree ("code");