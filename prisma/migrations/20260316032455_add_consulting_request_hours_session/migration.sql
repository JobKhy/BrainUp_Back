-- AlterTable
ALTER TABLE "ConsultingRequest" ADD COLUMN     "hours" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "stripeSessionId" TEXT;
