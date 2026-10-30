import { pool } from "@workspace/db";

export type PushTokenRegistration = {
  accountId: string;
  tokenFingerprint: string;
  encryptedToken: string;
  expiresAt: number;
};

export type StoredPushTokenRegistration = Pick<
  PushTokenRegistration,
  "tokenFingerprint" | "encryptedToken"
>;

export type StoredPushDeviceRegistration = Pick<
  PushTokenRegistration,
  "tokenFingerprint" | "expiresAt"
>;

export type PushTokenLimits = {
  maxTokensPerAccount: number;
  maxAccounts: number;
};

export interface PushTokenPersistence {
  pruneExpired(now: number): Promise<void>;
  pruneExpiredTestCooldowns(now: number): Promise<void>;
  claimTestCooldown(accountId: string, now: number, cooldownMs: number): Promise<boolean>;
  register(
    registration: PushTokenRegistration,
    now: number,
    limits: PushTokenLimits,
  ): Promise<boolean>;
  listActive(accountId: string, now: number): Promise<StoredPushTokenRegistration[]>;
  listDeviceRegistrations(
    accountId: string,
    now: number,
  ): Promise<StoredPushDeviceRegistration[]>;
  remove(accountId: string, tokenFingerprint: string): Promise<void>;
}

const REGISTRATION_LOCK_NAMESPACE = 721_071;
const REGISTRATION_LOCK_ID = 1;

export class PostgresPushTokenPersistence implements PushTokenPersistence {
  async pruneExpired(now: number) {
    await pool.query(
      "DELETE FROM push_device_registrations WHERE expires_at <= $1",
      [new Date(now)],
    );
  }

  async pruneExpiredTestCooldowns(now: number) {
    await pool.query(
      "DELETE FROM push_test_cooldowns WHERE expires_at <= $1",
      [new Date(now)],
    );
  }

  async claimTestCooldown(accountId: string, now: number, cooldownMs: number) {
    await this.pruneExpiredTestCooldowns(now);
    const result = await pool.query(
      `INSERT INTO push_test_cooldowns (account_id, expires_at)
       VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET expires_at = EXCLUDED.expires_at
       WHERE push_test_cooldowns.expires_at <= $3
       RETURNING account_id`,
      [accountId, new Date(now + cooldownMs), new Date(now)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async register(
    registration: PushTokenRegistration,
    now: number,
    limits: PushTokenLimits,
  ) {
    const client = await pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [REGISTRATION_LOCK_NAMESPACE, REGISTRATION_LOCK_ID],
      );
      await client.query(
        "DELETE FROM push_device_registrations WHERE expires_at <= $1",
        [new Date(now)],
      );

      const accountExists = await client.query(
        "SELECT 1 FROM push_device_registrations WHERE account_id = $1 LIMIT 1",
        [registration.accountId],
      );
      if (!accountExists.rowCount) {
        const accountCount = await client.query<{ count: number }>(
          "SELECT COUNT(DISTINCT account_id)::integer AS count FROM push_device_registrations",
        );
        if ((accountCount.rows[0]?.count ?? 0) >= limits.maxAccounts) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return false;
        }
      }

      const deviceCount = await client.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count
         FROM push_device_registrations
         WHERE account_id = $1 AND token_fingerprint <> $2`,
        [registration.accountId, registration.tokenFingerprint],
      );
      if ((deviceCount.rows[0]?.count ?? 0) >= limits.maxTokensPerAccount) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return false;
      }

      await client.query(
        `INSERT INTO push_device_registrations
           (token_fingerprint, account_id, encrypted_token, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (token_fingerprint) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           encrypted_token = EXCLUDED.encrypted_token,
           expires_at = EXCLUDED.expires_at`,
        [
          registration.tokenFingerprint,
          registration.accountId,
          registration.encryptedToken,
          new Date(registration.expiresAt),
        ],
      );
      await client.query("COMMIT");
      transactionOpen = false;
      return true;
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listActive(accountId: string, now: number) {
    const result = await pool.query<{
      token_fingerprint: string;
      encrypted_token: string;
    }>(
      `SELECT token_fingerprint, encrypted_token
       FROM push_device_registrations
       WHERE account_id = $1 AND expires_at > $2`,
      [accountId, new Date(now)],
    );
    return result.rows.map((row) => ({
      tokenFingerprint: row.token_fingerprint,
      encryptedToken: row.encrypted_token,
    }));
  }

  async listDeviceRegistrations(accountId: string, now: number) {
    const result = await pool.query<{
      token_fingerprint: string;
      expires_at: Date;
    }>(
      `SELECT token_fingerprint, expires_at
       FROM push_device_registrations
       WHERE account_id = $1 AND expires_at > $2
       ORDER BY expires_at DESC`,
      [accountId, new Date(now)],
    );
    return result.rows.map((row) => ({
      tokenFingerprint: row.token_fingerprint,
      expiresAt: row.expires_at.getTime(),
    }));
  }

  async remove(accountId: string, tokenFingerprint: string) {
    await pool.query(
      "DELETE FROM push_device_registrations WHERE account_id = $1 AND token_fingerprint = $2",
      [accountId, tokenFingerprint],
    );
  }
}
