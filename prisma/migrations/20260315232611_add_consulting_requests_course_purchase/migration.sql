-- CreateEnum
CREATE TYPE "EnrollmentSource" AS ENUM ('Subscription', 'Purchase');

-- CreateEnum
CREATE TYPE "ConsultingRequestStatus" AS ENUM ('Pending', 'Scheduled', 'Completed', 'Cancelled');

-- AlterTable
ALTER TABLE "CourseEnrollment" ADD COLUMN     "source" "EnrollmentSource" NOT NULL DEFAULT 'Subscription',
ADD COLUMN     "stripeSessionId" TEXT;

-- CreateTable
CREATE TABLE "ConsultingRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "preferredDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "status" "ConsultingRequestStatus" NOT NULL DEFAULT 'Pending',
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultingRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ConsultingRequest" ADD CONSTRAINT "ConsultingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultingRequest" ADD CONSTRAINT "ConsultingRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
