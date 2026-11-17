# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Verified Identity Required for Privileged Data**: Only users signed in with Google (`request.auth != null && request.auth.token.email_verified == true`) can create or read their own `UserProfile` (`/users/{userId}`) or `ShopProfile` (`/shops/{shopId}`). Drivers remain completely anonymous on the Express/WS layer and have zero write access to Firestore.
2. **No Self-Assigned Admin Privileges**: A non-admin user (`request.auth.token.email != 'mmubariz085@gmail.com'`) cannot create `/users/{uid}` with `role == 'admin'`, cannot write to `/admins/{uid}`, and cannot promote themselves to `'admin'` on update.
3. **Shop Subscription Integrity**: A shop owner registering with Gmail can create their own `/shops/{shopId}` only with `ownerUid == request.auth.uid`, `ownerEmail == request.auth.token.email`, `tariff == 'Test'`, and `status == 'Aktiv'`. On subsequent updates, the shop owner can only edit profile fields (`name`, `district`, `whatsapp`, `telegramChatId`, `updatedAt`) and can NEVER alter `tariff`, `expiresAt`, `status`, or `ownerUid`.
4. **PII Isolation & Query Enforcement**: `/users/{userId}` and `/shops/{shopId}` contain email and phone PII. Unauthenticated reads are rejected, cross-user reads are rejected, and `allow list` rules explicitly filter `resource.data.ownerUid == request.auth.uid` (without calling `get()`/`exists()` inside `allow list`).
5. **Temporal & Structural Integrity**: All `createdAt`/`updatedAt` timestamps must match `request.time` on creation/update, `createdAt` is immutable, every string field enforces `.size()` bounds, document IDs match `^[a-zA-Z0-9_\-]+$`, and `keys().hasOnly(...)` / `affectedKeys().hasOnly(...)` reject all shadow/ghost fields.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Shop Read**: Anonymous user tries `get /shops/shop_1` -> DENIED.
2. **Unauthenticated Shop Create**: Anonymous user tries `create /shops/shop_2` -> DENIED.
3. **Email Spoofing (Unverified Email)**: User with `email: 'mmubariz085@gmail.com'` and `email_verified: false` tries `read /shops` or `create /admins/{uid}` -> DENIED.
4. **Self-Assigned Admin Role**: Non-admin user tries `create /users/{uid}` with `{ role: 'admin', ... }` -> DENIED.
5. **Role Escalation via Update**: Existing shop user tries `update /users/{uid}` changing `{ role: 'admin' }` -> DENIED.
6. **Privilege Escalation on `/admins`**: Non-admin user tries `create /admins/{uid}` -> DENIED.
7. **Shop Self-Upgrading Tariff**: Shop owner tries `create /shops/{id}` with `{ tariff: 'VIP 40 AZN' }` -> DENIED.
8. **Shop Modifying Expiry/Status**: Shop owner tries `update /shops/{id}` changing `{ expiresAt: '2099-12-31', status: 'Aktiv' }` -> DENIED.
9. **Cross-Owner Shop Hijack**: Shop A tries `get /shops/shop_B` or `update /shops/shop_B` -> DENIED.
10. **Shadow / Ghost Field Injection**: User tries `update /shops/{id}` with `{ name: 'Valid', isVerified: true }` -> DENIED.
11. **ID Poisoning / Resource Exhaustion**: User tries `create /shops/${'a'.repeat(500)}` or injects 10KB string into `name` -> DENIED.
12. **Timestamp Backdating / Tampering**: User tries `create /shops/{id}` with client-supplied `createdAt` or `update /shops/{id}` modifying `createdAt` -> DENIED.
