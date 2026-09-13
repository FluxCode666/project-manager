-- CreateTable
CREATE TABLE "BackupConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "webdavUrl" TEXT,
    "webdavPath" TEXT,
    "username" TEXT,
    "password" TEXT,
    "retention" INTEGER NOT NULL DEFAULT 14,
    "cronEvery" INTEGER NOT NULL DEFAULT 24,
    "lastRunAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BackupLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "remoteUrl" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
