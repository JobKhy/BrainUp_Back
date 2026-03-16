-- CreateEnum
CREATE TYPE "ConsultingPackageType" AS ENUM ('Hourly', 'Pack8');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'Staff';

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "durationWeeks" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "stripePriceId" TEXT;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Consulting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "whatsapp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consulting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultingPurchase" (
    "id" TEXT NOT NULL,
    "consultingId" TEXT NOT NULL,
    "packageType" "ConsultingPackageType" NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "stripePriceId" TEXT,
    "stripeSessionId" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultingPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultingDeduction" (
    "id" TEXT NOT NULL,
    "consultingId" TEXT NOT NULL,
    "hoursDeducted" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultingDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Consulting_userId_key" ON "Consulting"("userId");

-- AddForeignKey
ALTER TABLE "Consulting" ADD CONSTRAINT "Consulting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultingPurchase" ADD CONSTRAINT "ConsultingPurchase_consultingId_fkey" FOREIGN KEY ("consultingId") REFERENCES "Consulting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultingDeduction" ADD CONSTRAINT "ConsultingDeduction_consultingId_fkey" FOREIGN KEY ("consultingId") REFERENCES "Consulting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultingDeduction" ADD CONSTRAINT "ConsultingDeduction_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
