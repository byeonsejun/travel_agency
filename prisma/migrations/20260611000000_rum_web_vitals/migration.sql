-- CreateTable
CREATE TABLE "WebVitalEvent" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "rating" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "navType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebVitalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebVitalEvent_metric_createdAt_idx" ON "WebVitalEvent"("metric", "createdAt");

-- CreateIndex
CREATE INDEX "WebVitalEvent_route_metric_createdAt_idx" ON "WebVitalEvent"("route", "metric", "createdAt");
