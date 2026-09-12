CREATE TYPE "public"."device_status" AS ENUM('active', 'paused', 'nodata', 'rec', 'offline');--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"hotel_id" varchar(16) NOT NULL,
	"role_id" varchar(32) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"hotel_id" varchar(16) NOT NULL,
	"floor_id" varchar(32),
	"computer_name" varchar(80) NOT NULL,
	"name" varchar(120) DEFAULT '' NOT NULL,
	"department" varchar(80),
	"type" varchar(40) DEFAULT 'Desktop' NOT NULL,
	"status" "device_status" DEFAULT 'active' NOT NULL,
	"x" real,
	"y" real,
	"dir" real,
	"is_ap" boolean DEFAULT false NOT NULL,
	"os" varchar(80),
	"cpu" varchar(120),
	"ram" varchar(80),
	"motherboard" varchar(120),
	"graphics" varchar(120),
	"storage" varchar(120),
	"monitor" varchar(120),
	"model" varchar(120),
	"ip" varchar(64),
	"resolution" varchar(80),
	"lens" varchar(80),
	"retention" varchar(40),
	"nvr" varchar(60),
	"codec" varchar(40),
	"poe" varchar(40),
	"ssid" varchar(120),
	"band" varchar(40),
	"channel" varchar(40),
	"clients" varchar(16),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "devices_hotel_computer_uq" UNIQUE("hotel_id","computer_name")
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" varchar(32) NOT NULL,
	"hotel_id" varchar(16) NOT NULL,
	"name" varchar(120) NOT NULL,
	"short" varchar(60) NOT NULL,
	"route" varchar(60) DEFAULT '' NOT NULL,
	"kind" varchar(16) DEFAULT 'workstation' NOT NULL,
	"image" varchar(255),
	"aspect" real DEFAULT 0.75 NOT NULL,
	"departments" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "floors_hotel_id_id_pk" PRIMARY KEY("hotel_id","id")
);
--> statement-breakpoint
CREATE TABLE "group_hotels" (
	"group_id" integer NOT NULL,
	"hotel_id" varchar(16) NOT NULL,
	CONSTRAINT "group_hotels_group_id_hotel_id_pk" PRIMARY KEY("group_id","hotel_id")
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"role_id" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hotels" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"code" varchar(8) NOT NULL,
	"name" varchar(120) NOT NULL,
	"city" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"perms" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(32),
	"title" varchar(120),
	"department" varchar(80),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"last_login" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_floor_fk" FOREIGN KEY ("hotel_id","floor_id") REFERENCES "public"."floors"("hotel_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_hotels" ADD CONSTRAINT "group_hotels_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_hotels" ADD CONSTRAINT "group_hotels_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;